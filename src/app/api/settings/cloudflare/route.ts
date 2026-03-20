import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import {
  getMaskedSettings,
  saveCloudflareSettings,
  getCloudflareSettings,
  verifyConnection,
  verifyZone,
  listZones,
} from "@server/services/cloudflare";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    return ok(getMaskedSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const body = await req.json();

    // If apiToken looks masked, keep the existing one
    const existing = getCloudflareSettings();
    const apiToken =
      typeof body.apiToken === "string" && !body.apiToken.includes("••")
        ? body.apiToken
        : existing.apiToken;

    saveCloudflareSettings({
      apiToken,
      zones: Array.isArray(body.zones) ? body.zones : existing.zones,
      autoSync: typeof body.autoSync === "boolean" ? body.autoSync : existing.autoSync,
      defaultZone: typeof body.defaultZone === "string" ? body.defaultZone : existing.defaultZone,
    });

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "settings", targetType: "setting", targetName: "cloudflare", ipAddress: getClientIp(req) });
    return ok(getMaskedSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();

    const existing = getCloudflareSettings();
    const apiToken =
      typeof body.apiToken === "string" && !body.apiToken.includes("••")
        ? body.apiToken
        : existing.apiToken;

    // List all available zones for the API token
    if (body.action === "listZones") {
      const zones = await listZones(apiToken);
      return ok(zones);
    }

    // Individual zone verification
    if (typeof body.zoneId === "string" && body.zoneId) {
      const result = await verifyZone(body.zoneId, apiToken);
      return ok(result);
    }

    // General connection test (first zone)
    const result = await verifyConnection();
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
