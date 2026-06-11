// MCP service token settings.
//
// Proxima exposes its REST API to a local stdio MCP server. The MCP server
// authenticates with a long-lived service token sent in the `X-Service-Token`
// header. By default the token is only accepted from loopback connections
// (see `isLocalRequest` in api/_lib/auth) so the token can't be replayed from
// outside the host even if Proxima is exposed via a tunnel/reverse proxy.

import { getDb, dbHelpers } from "@server/db/index";
import { randomBytes } from "node:crypto";

export interface McpSettings {
  enabled: boolean;
  localOnly: boolean;
  hasToken: boolean;
}

/** Raw auth values used by the auth middleware. */
export function getMcpAuth(): { enabled: boolean; apiToken: string; localOnly: boolean } {
  const db = getDb();
  const enabled = dbHelpers.getSetting(db, "mcp:enabled")?.value === "true";
  const apiToken = dbHelpers.getSetting(db, "mcp:apiToken")?.value ?? "";
  // Local-only defaults to ON — opt out explicitly.
  const localOnly = (dbHelpers.getSetting(db, "mcp:localOnly")?.value ?? "true") !== "false";
  return { enabled, apiToken, localOnly };
}

/** Settings shape exposed to the UI (token redacted). */
export function getMcpSettings(): McpSettings {
  const { enabled, apiToken, localOnly } = getMcpAuth();
  return { enabled, localOnly, hasToken: apiToken.length > 0 };
}

export function updateMcpSettings(data: { enabled?: boolean; localOnly?: boolean }): McpSettings {
  const db = getDb();
  if (data.enabled !== undefined) dbHelpers.setSetting(db, "mcp:enabled", String(data.enabled));
  if (data.localOnly !== undefined) dbHelpers.setSetting(db, "mcp:localOnly", String(data.localOnly));
  return getMcpSettings();
}

export function regenerateMcpToken(): string {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  dbHelpers.setSetting(db, "mcp:apiToken", token);
  return token;
}

/** Return the current token, generating one on first access. */
export function getMcpToken(): string {
  const db = getDb();
  const existing = dbHelpers.getSetting(db, "mcp:apiToken")?.value;
  if (existing) return existing;
  return regenerateMcpToken();
}
