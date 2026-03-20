import { getDb, dbHelpers } from "../db/index";
import { logger } from "../lib/logger";
import type { CloudflareSettingsResponse, CloudflareTestResult, CloudflareTunnelSettingsResponse, CloudflareZone } from "@/types";

const CF_API = "https://api.cloudflare.com/client/v4";

const SETTING_KEYS = {
  apiToken: "cloudflare:apiToken",
  zoneId: "cloudflare:zoneId", // legacy — kept for migration
  zones: "cloudflare:zones",
  autoSync: "cloudflare:autoSync",
  defaultZone: "cloudflare:defaultZone",
} as const;

export interface CloudflareSettings {
  apiToken: string;
  zones: CloudflareZone[];
  autoSync: boolean;
  defaultZone?: string;
}

export function getCloudflareSettings(): CloudflareSettings {
  const db = getDb();
  const apiToken = dbHelpers.getSetting(db, SETTING_KEYS.apiToken)?.value ?? "";
  const autoSync = dbHelpers.getSetting(db, SETTING_KEYS.autoSync)?.value === "true";

  // Try loading zones JSON
  const zonesRaw = dbHelpers.getSetting(db, SETTING_KEYS.zones)?.value;
  let zones: CloudflareZone[] = [];
  if (zonesRaw) {
    try {
      zones = JSON.parse(zonesRaw);
    } catch {
      zones = [];
    }
  }

  // Legacy migration: if no zones but old zoneId exists, convert
  if (zones.length === 0) {
    const legacyZoneId = dbHelpers.getSetting(db, SETTING_KEYS.zoneId)?.value ?? "";
    if (legacyZoneId) {
      zones = [{ zoneId: legacyZoneId, zoneName: "" }];
    }
  }

  const defaultZone = dbHelpers.getSetting(db, SETTING_KEYS.defaultZone)?.value ?? "";

  return { apiToken, zones, autoSync, defaultZone: defaultZone || undefined };
}

export function saveCloudflareSettings(data: CloudflareSettings): void {
  const db = getDb();
  dbHelpers.setSetting(db, SETTING_KEYS.apiToken, data.apiToken);
  dbHelpers.setSetting(db, SETTING_KEYS.zones, JSON.stringify(data.zones));
  dbHelpers.setSetting(db, SETTING_KEYS.autoSync, String(data.autoSync));
  dbHelpers.setSetting(db, SETTING_KEYS.defaultZone, data.defaultZone ?? "");
  // Clear legacy key on save
  dbHelpers.setSetting(db, SETTING_KEYS.zoneId, "");
}

export function getMaskedSettings(): CloudflareSettingsResponse {
  const s = getCloudflareSettings();
  return {
    ...s,
    apiToken: maskToken(s.apiToken),
  };
}

export function resolveZoneForDomain(domain: string, zones: CloudflareZone[]): CloudflareZone | null {
  // Sort by zoneName length descending for longest suffix match
  const sorted = [...zones].sort((a, b) => b.zoneName.length - a.zoneName.length);
  for (const zone of sorted) {
    if (!zone.zoneName) continue;
    if (domain === zone.zoneName || domain.endsWith("." + zone.zoneName)) {
      return zone;
    }
  }
  // Fallback: if there's exactly one zone with empty zoneName (legacy migration), use it
  const emptyNameZones = zones.filter(z => !z.zoneName);
  if (emptyNameZones.length === 1) {
    return emptyNameZones[0];
  }
  return null;
}

export async function verifyZone(zoneId: string, apiToken: string): Promise<CloudflareTestResult> {
  if (!apiToken || !zoneId) {
    return { valid: false, error: "API Token and Zone ID are required" };
  }
  try {
    const res = await cfFetch<{ id: string; name: string }>(`/zones/${zoneId}`, apiToken);
    if (res.success && res.result) {
      return { valid: true, zoneName: res.result.name };
    }
    const errMsg = res.errors?.[0]?.message ?? "Unknown error";
    return { valid: false, error: errMsg };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
}

function maskToken(token: string): string {
  if (!token || token.length < 4) return token ? "••••" : "";
  return "••••••••" + token.slice(-4);
}

export async function listZones(apiToken: string): Promise<CloudflareZone[]> {
  if (!apiToken) throw new Error("API Token is required");
  const res = await cfFetch<Array<{ id: string; name: string }>>("/zones?per_page=50&status=active", apiToken);
  if (res.success && res.result) {
    return res.result.map(z => ({ zoneId: z.id, zoneName: z.name }));
  }
  const errMsg = res.errors?.[0]?.message ?? "Failed to fetch zones";
  throw new Error(errMsg);
}

// === Tunnel Settings ===

const TUNNEL_SETTING_KEYS = {
  enabled: "cloudflare:tunnel:enabled",
  tunnelId: "cloudflare:tunnel:tunnelId",
  tunnelName: "cloudflare:tunnel:tunnelName",
  accountId: "cloudflare:tunnel:accountId",
  tunnelToken: "cloudflare:tunnel:tunnelToken",
} as const;

export interface TunnelSettings {
  enabled: boolean;
  tunnelId: string;
  tunnelName: string;
  accountId: string;
  tunnelToken: string;
}

export function getTunnelSettings(): TunnelSettings {
  const db = getDb();
  return {
    enabled: dbHelpers.getSetting(db, TUNNEL_SETTING_KEYS.enabled)?.value === "true",
    tunnelId: dbHelpers.getSetting(db, TUNNEL_SETTING_KEYS.tunnelId)?.value ?? "",
    tunnelName: dbHelpers.getSetting(db, TUNNEL_SETTING_KEYS.tunnelName)?.value ?? "",
    accountId: dbHelpers.getSetting(db, TUNNEL_SETTING_KEYS.accountId)?.value ?? "",
    tunnelToken: dbHelpers.getSetting(db, TUNNEL_SETTING_KEYS.tunnelToken)?.value ?? "",
  };
}

export function saveTunnelSettings(data: TunnelSettings): void {
  const db = getDb();
  dbHelpers.setSetting(db, TUNNEL_SETTING_KEYS.enabled, String(data.enabled));
  dbHelpers.setSetting(db, TUNNEL_SETTING_KEYS.tunnelId, data.tunnelId);
  dbHelpers.setSetting(db, TUNNEL_SETTING_KEYS.tunnelName, data.tunnelName);
  dbHelpers.setSetting(db, TUNNEL_SETTING_KEYS.accountId, data.accountId);
  dbHelpers.setSetting(db, TUNNEL_SETTING_KEYS.tunnelToken, data.tunnelToken);
}

export function getMaskedTunnelSettings(): CloudflareTunnelSettingsResponse {
  const s = getTunnelSettings();
  return {
    enabled: s.enabled,
    tunnelId: s.tunnelId,
    tunnelName: s.tunnelName,
    accountId: s.accountId,
    tunnelToken: maskToken(s.tunnelToken),
  };
}

export async function cfFetch<T>(path: string, token: string, options?: RequestInit): Promise<{ success: boolean; result?: T; errors?: Array<{ message: string }> }> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res.json();
}

export async function verifyConnection(): Promise<CloudflareTestResult> {
  const settings = getCloudflareSettings();
  if (!settings.apiToken || settings.zones.length === 0) {
    return { valid: false, error: "API Token and at least one Zone are required" };
  }
  // Verify the first zone as a basic connectivity check
  return verifyZone(settings.zones[0].zoneId, settings.apiToken);
}

interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

async function findDnsRecord(domain: string, token: string, zoneId: string, type: "A" | "CNAME" = "A"): Promise<CfDnsRecord | null> {
  const res = await cfFetch<CfDnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=${type}&name=${encodeURIComponent(domain)}`,
    token
  );
  if (res.success && res.result && res.result.length > 0) {
    return res.result[0];
  }
  return null;
}

export async function upsertDnsRecord(domain: string): Promise<void> {
  const settings = getCloudflareSettings();
  if (!settings.autoSync || !settings.apiToken || settings.zones.length === 0) {
    return;
  }

  // Skip wildcard domains
  if (domain.startsWith("*.")) {
    logger.debug("cloudflare", `Skipping wildcard domain: ${domain}`);
    return;
  }

  const zone = resolveZoneForDomain(domain, settings.zones);
  if (!zone) {
    logger.warn("cloudflare", `No matching zone for domain ${domain}, skipping DNS upsert`);
    return;
  }

  const tunnel = getTunnelSettings();
  if (!tunnel.enabled || !tunnel.tunnelId) {
    logger.debug("cloudflare", `Tunnel not configured, skipping DNS for ${domain}`);
    return;
  }

  try {
    const content = `${tunnel.tunnelId}.cfargotunnel.com`;

    // Delete any stale A record if it exists
    const staleA = await findDnsRecord(domain, settings.apiToken, zone.zoneId, "A");
    if (staleA) {
      await cfFetch(`/zones/${zone.zoneId}/dns_records/${staleA.id}`, settings.apiToken, {
        method: "DELETE",
      });
      logger.info("cloudflare", `Deleted stale A record for ${domain}`);
    }

    const existing = await findDnsRecord(domain, settings.apiToken, zone.zoneId, "CNAME");
    const body = JSON.stringify({
      type: "CNAME",
      name: domain,
      content,
      proxied: true,
      ttl: 1, // auto
    });

    if (existing) {
      await cfFetch(`/zones/${zone.zoneId}/dns_records/${existing.id}`, settings.apiToken, {
        method: "PUT",
        body,
      });
      logger.info("cloudflare", `Updated CNAME record for ${domain} → ${content}`);
    } else {
      await cfFetch(`/zones/${zone.zoneId}/dns_records`, settings.apiToken, {
        method: "POST",
        body,
      });
      logger.info("cloudflare", `Created CNAME record for ${domain} → ${content}`);
    }
  } catch (err) {
    logger.warn("cloudflare", `Failed to upsert DNS record for ${domain}: ${err}`);
  }
}

export async function deleteDnsRecord(domain: string): Promise<void> {
  const settings = getCloudflareSettings();
  if (!settings.autoSync || !settings.apiToken || settings.zones.length === 0) {
    return;
  }

  if (domain.startsWith("*.")) {
    return;
  }

  const zone = resolveZoneForDomain(domain, settings.zones);
  if (!zone) {
    logger.warn("cloudflare", `No matching zone for domain ${domain}, skipping DNS delete`);
    return;
  }

  try {
    // Search both A and CNAME records
    for (const type of ["A", "CNAME"] as const) {
      const existing = await findDnsRecord(domain, settings.apiToken, zone.zoneId, type);
      if (existing) {
        await cfFetch(`/zones/${zone.zoneId}/dns_records/${existing.id}`, settings.apiToken, {
          method: "DELETE",
        });
        logger.info("cloudflare", `Deleted ${type} record for ${domain}`);
      }
    }
  } catch (err) {
    logger.warn("cloudflare", `Failed to delete DNS record for ${domain}: ${err}`);
  }
}

export async function syncDomainsCreate(domains: string[]): Promise<void> {
  for (const domain of domains) {
    await upsertDnsRecord(domain);
  }
}

export async function syncDomainsDelete(domains: string[]): Promise<void> {
  for (const domain of domains) {
    await deleteDnsRecord(domain);
  }
}
