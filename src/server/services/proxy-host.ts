import { eq } from "drizzle-orm";
import { getDb } from "../db/index";
import { proxyHosts, type ProxyHost, type NewProxyHost } from "../db/schema";
import { logger } from "../lib/logger";
import { ValidationError } from "../lib/errors";
import { syncCloudflaredConfig } from "./cloudflared";
import { syncDomainsCreate, syncDomainsDelete } from "./cloudflare";
import type { ProxyLocation } from "@/types";

// Shape of data coming from the socket (camelCase, JSON-stringified arrays)
export interface CreateProxyHostData {
  domainNames: string[];
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
  cachingEnabled?: boolean;
  blockExploits?: boolean;
  allowWebsocketUpgrade?: boolean;
  http2Support?: boolean;
  enabled?: boolean;
  locations?: ProxyLocation[];
  meta?: Record<string, unknown>;
}

export type UpdateProxyHostData = Partial<CreateProxyHostData>;

function serializeRow(host: ProxyHost): ProxyHost & {
  domainNames: string[];
  locations: ProxyLocation[];
  meta: Record<string, unknown>;
} {
  return {
    ...host,
    domainNames: typeof host.domainNames === "string"
      ? JSON.parse(host.domainNames)
      : host.domainNames,
    locations: typeof host.locations === "string"
      ? JSON.parse(host.locations)
      : host.locations,
    meta: typeof host.meta === "string"
      ? JSON.parse(host.meta)
      : host.meta,
  } as ProxyHost & { domainNames: string[]; locations: ProxyLocation[]; meta: Record<string, unknown> };
}

export async function isDomainTaken(domain: string, excludeId?: number): Promise<boolean> {
  const db = getDb();
  const allHosts = await db.select({ id: proxyHosts.id, domainNames: proxyHosts.domainNames })
    .from(proxyHosts)
    .all();

  for (const host of allHosts) {
    if (excludeId !== undefined && host.id === excludeId) continue;
    const domains: string[] = typeof host.domainNames === "string"
      ? JSON.parse(host.domainNames)
      : host.domainNames;
    if (domains.includes(domain)) return true;
  }
  return false;
}

export async function list(): Promise<ReturnType<typeof serializeRow>[]> {
  const db = getDb();
  const rows = await db.select().from(proxyHosts).all();
  return rows.map(serializeRow);
}

export async function get(id: number): Promise<ReturnType<typeof serializeRow>> {
  const db = getDb();
  const row = await db.select().from(proxyHosts).where(eq(proxyHosts.id, id)).get();
  if (!row) {
    throw new ValidationError(`Proxy host ${id} not found`);
  }
  return serializeRow(row);
}

export type ProxyHostResult = ReturnType<typeof serializeRow> & { _warnings?: string[] };

export async function create(data: CreateProxyHostData): Promise<ProxyHostResult> {
  // Validate no duplicate domains within the request
  const unique = new Set(data.domainNames);
  if (unique.size !== data.domainNames.length) {
    throw new ValidationError("Duplicate domain names in request");
  }
  if (data.domainNames.length === 0) {
    throw new ValidationError("At least one domain name is required");
  }

  // Check all domains are available
  for (const domain of data.domainNames) {
    if (await isDomainTaken(domain)) {
      throw new ValidationError(`Domain ${domain} is already in use`);
    }
  }

  const db = getDb();

  const insertData: NewProxyHost = {
    domainNames: JSON.stringify(data.domainNames),
    forwardScheme: data.forwardScheme,
    forwardHost: data.forwardHost,
    forwardPort: data.forwardPort,
    cachingEnabled: data.cachingEnabled ?? false,
    blockExploits: data.blockExploits ?? false,
    allowWebsocketUpgrade: data.allowWebsocketUpgrade ?? false,
    http2Support: data.http2Support ?? false,
    enabled: data.enabled ?? true,
    locations: JSON.stringify(data.locations ?? []),
    meta: JSON.stringify(data.meta ?? {}),
  };

  const result = await db.insert(proxyHosts).values(insertData).returning().get();
  if (!result) {
    throw new Error("Failed to insert proxy host");
  }

  const host = serializeRow(result);
  const warnings: string[] = [];

  // Sync cloudflared tunnel ingress + DNS records
  try {
    await syncCloudflaredConfig();
  } catch (err) {
    const msg = `Tunnel ingress sync failed: ${err instanceof Error ? err.message : err}`;
    logger.warn("proxy-host", msg);
    warnings.push(msg);
  }
  try {
    await syncDomainsCreate(data.domainNames);
  } catch (err) {
    const msg = `DNS sync failed: ${err instanceof Error ? err.message : err}`;
    logger.warn("proxy-host", msg);
    warnings.push(msg);
  }

  logger.info("proxy-host", `Created proxy host ${host.id}: ${data.domainNames.join(", ")}`);
  return Object.assign(host, { _warnings: warnings });
}

export async function update(id: number, data: UpdateProxyHostData): Promise<ProxyHostResult> {
  // Verify host exists
  const existing = await get(id);

  // Check domain availability (exclude current host)
  if (data.domainNames !== undefined) {
    if (data.domainNames.length === 0) {
      throw new ValidationError("At least one domain name is required");
    }
    const unique = new Set(data.domainNames);
    if (unique.size !== data.domainNames.length) {
      throw new ValidationError("Duplicate domain names in request");
    }
    for (const domain of data.domainNames) {
      if (await isDomainTaken(domain, id)) {
        throw new ValidationError(`Domain ${domain} is already in use`);
      }
    }
  }

  const db = getDb();

  const updateData: Partial<NewProxyHost> & { updatedAt?: string } = {
    updatedAt: new Date().toISOString(),
  };

  if (data.domainNames !== undefined) updateData.domainNames = JSON.stringify(data.domainNames);
  if (data.forwardScheme !== undefined) updateData.forwardScheme = data.forwardScheme;
  if (data.forwardHost !== undefined) updateData.forwardHost = data.forwardHost;
  if (data.forwardPort !== undefined) updateData.forwardPort = data.forwardPort;
  if (data.cachingEnabled !== undefined) updateData.cachingEnabled = data.cachingEnabled;
  if (data.blockExploits !== undefined) updateData.blockExploits = data.blockExploits;
  if (data.allowWebsocketUpgrade !== undefined) updateData.allowWebsocketUpgrade = data.allowWebsocketUpgrade;
  if (data.http2Support !== undefined) updateData.http2Support = data.http2Support;
  if (data.enabled !== undefined) updateData.enabled = data.enabled;
  if (data.locations !== undefined) updateData.locations = JSON.stringify(data.locations);
  if (data.meta !== undefined) updateData.meta = JSON.stringify(data.meta);

  await db.update(proxyHosts).set(updateData).where(eq(proxyHosts.id, id));

  const updated = await get(id);
  const warnings: string[] = [];

  // Sync cloudflared tunnel ingress + DNS records
  try {
    await syncCloudflaredConfig();
  } catch (err) {
    const msg = `Tunnel ingress sync failed: ${err instanceof Error ? err.message : err}`;
    logger.warn("proxy-host", msg);
    warnings.push(msg);
  }
  if (data.domainNames) {
    const oldDomains: string[] = existing.domainNames;
    const removed = oldDomains.filter((d) => !data.domainNames!.includes(d));
    const added = data.domainNames.filter((d) => !oldDomains.includes(d));
    if (removed.length > 0) {
      try {
        await syncDomainsDelete(removed);
      } catch (err) {
        const msg = `DNS delete sync failed: ${err instanceof Error ? err.message : err}`;
        logger.warn("proxy-host", msg);
        warnings.push(msg);
      }
    }
    if (added.length > 0) {
      try {
        await syncDomainsCreate(added);
      } catch (err) {
        const msg = `DNS create sync failed: ${err instanceof Error ? err.message : err}`;
        logger.warn("proxy-host", msg);
        warnings.push(msg);
      }
    }
  }

  logger.info("proxy-host", `Updated proxy host ${id}`);
  return Object.assign(updated, { _warnings: warnings });
}

export async function remove(id: number): Promise<void> {
  // Verify exists and preserve domain info for DNS cleanup
  const host = await get(id);
  const domains: string[] = host.domainNames;

  const db = getDb();
  await db.delete(proxyHosts).where(eq(proxyHosts.id, id));

  // Sync cloudflared tunnel ingress + DNS records
  try {
    await syncCloudflaredConfig();
  } catch (err) {
    logger.warn("proxy-host", `Cloudflared config sync failed: ${err}`);
  }
  try {
    await syncDomainsDelete(domains);
  } catch (err) {
    logger.warn("proxy-host", `DNS cleanup failed: ${err}`);
  }

  logger.info("proxy-host", `Deleted proxy host ${id}`);
}
