import { getDb, dbHelpers } from "../db/index";
import { logger } from "../lib/logger";
import type { CloudflareSettingsResponse, CloudflareTestResult, CloudflareTunnelSettingsResponse } from "@/types";

const CF_API = "https://api.cloudflare.com/client/v4";

const SETTING_KEYS = {
  apiToken: "cloudflare:apiToken",
  zoneId: "cloudflare:zoneId",
  autoSync: "cloudflare:autoSync",
} as const;

export interface CloudflareSettings {
  apiToken: string;
  zoneId: string;
  autoSync: boolean;
}

export function getCloudflareSettings(): CloudflareSettings {
  const db = getDb();
  return {
    apiToken: dbHelpers.getSetting(db, SETTING_KEYS.apiToken)?.value ?? "",
    zoneId: dbHelpers.getSetting(db, SETTING_KEYS.zoneId)?.value ?? "",
    autoSync: dbHelpers.getSetting(db, SETTING_KEYS.autoSync)?.value === "true",
  };
}

export function saveCloudflareSettings(data: CloudflareSettings): void {
  const db = getDb();
  dbHelpers.setSetting(db, SETTING_KEYS.apiToken, data.apiToken);
  dbHelpers.setSetting(db, SETTING_KEYS.zoneId, data.zoneId);
  dbHelpers.setSetting(db, SETTING_KEYS.autoSync, String(data.autoSync));
}

export function getMaskedSettings(): CloudflareSettingsResponse {
  const s = getCloudflareSettings();
  return {
    ...s,
    apiToken: maskToken(s.apiToken),
  };
}

function maskToken(token: string): string {
  if (!token || token.length < 4) return token ? "••••" : "";
  return "••••••••" + token.slice(-4);
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
  if (!settings.apiToken || !settings.zoneId) {
    return { valid: false, error: "API Token and Zone ID are required" };
  }

  try {
    const res = await cfFetch<{ id: string; name: string }>(`/zones/${settings.zoneId}`, settings.apiToken);
    if (res.success && res.result) {
      return { valid: true, zoneName: res.result.name };
    }
    const errMsg = res.errors?.[0]?.message ?? "Unknown error";
    return { valid: false, error: errMsg };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Connection failed" };
  }
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
  if (!settings.autoSync || !settings.apiToken || !settings.zoneId) {
    return;
  }

  // Skip wildcard domains
  if (domain.startsWith("*.")) {
    logger.debug("cloudflare", `Skipping wildcard domain: ${domain}`);
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
    const staleA = await findDnsRecord(domain, settings.apiToken, settings.zoneId, "A");
    if (staleA) {
      await cfFetch(`/zones/${settings.zoneId}/dns_records/${staleA.id}`, settings.apiToken, {
        method: "DELETE",
      });
      logger.info("cloudflare", `Deleted stale A record for ${domain}`);
    }

    const existing = await findDnsRecord(domain, settings.apiToken, settings.zoneId, "CNAME");
    const body = JSON.stringify({
      type: "CNAME",
      name: domain,
      content,
      proxied: true,
      ttl: 1, // auto
    });

    if (existing) {
      await cfFetch(`/zones/${settings.zoneId}/dns_records/${existing.id}`, settings.apiToken, {
        method: "PUT",
        body,
      });
      logger.info("cloudflare", `Updated CNAME record for ${domain} → ${content}`);
    } else {
      await cfFetch(`/zones/${settings.zoneId}/dns_records`, settings.apiToken, {
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
  if (!settings.autoSync || !settings.apiToken || !settings.zoneId) {
    return;
  }

  if (domain.startsWith("*.")) {
    return;
  }

  try {
    // Search both A and CNAME records
    for (const type of ["A", "CNAME"] as const) {
      const existing = await findDnsRecord(domain, settings.apiToken, settings.zoneId, type);
      if (existing) {
        await cfFetch(`/zones/${settings.zoneId}/dns_records/${existing.id}`, settings.apiToken, {
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
