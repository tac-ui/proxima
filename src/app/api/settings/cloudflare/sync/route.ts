import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { syncAllDns } from "@server/services/cloudflare";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);

    const result = await syncAllDns();

    logAudit({
      userId: auth.userId,
      username: auth.username,
      action: "sync",
      category: "settings",
      targetType: "setting",
      targetName: "cloudflare-dns-sync-all",
      ipAddress: getClientIp(req),
    });

    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
