import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getMcpSettings, updateMcpSettings } from "@server/services/mcp";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);
    return ok(getMcpSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireAdmin(req);
    const body = await req.json() as { enabled?: boolean; localOnly?: boolean };
    const settings = updateMcpSettings({ enabled: body.enabled, localOnly: body.localOnly });
    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "settings", targetType: "mcp", targetName: "mcp", ipAddress: getClientIp(req) });
    return ok(settings);
  } catch (err) {
    return errorResponse(err);
  }
}
