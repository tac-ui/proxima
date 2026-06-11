import { type NextRequest } from "next/server";
import { requireAdmin, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { getMcpToken, regenerateMcpToken } from "@server/services/mcp";
import { logAudit, getClientIp } from "@server/services/audit";

// Reveal the current token (generating one on first access).
export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAdmin(req);
    return ok({ token: getMcpToken() });
  } catch (err) {
    return errorResponse(err);
  }
}

// Rotate the token — invalidates any existing MCP server config.
export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireAdmin(req);
    const token = regenerateMcpToken();
    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "settings", targetType: "mcp", targetName: "mcp-token", ipAddress: getClientIp(req) });
    return ok({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
