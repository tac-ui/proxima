import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import {
  getMaskedSettings,
  saveCloudflareSettings,
  getCloudflareSettings,
  verifyConnection,
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
      zoneId: typeof body.zoneId === "string" ? body.zoneId : existing.zoneId,
      autoSync: typeof body.autoSync === "boolean" ? body.autoSync : existing.autoSync,
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
    const result = await verifyConnection();
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
