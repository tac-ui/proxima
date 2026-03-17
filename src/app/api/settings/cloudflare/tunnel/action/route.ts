import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../../_lib/auth";
import { ensureDb } from "../../../../_lib/db";
import { getTunnelSettings } from "@server/services/cloudflare";
import { startCloudflared, stopCloudflared, restartCloudflared } from "@server/services/cloudflared";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const body = await req.json();
    const { action } = body as { action: string };

    if (!["start", "stop", "restart"].includes(action)) {
      return errorResponse(new Error("Invalid action. Must be start, stop, or restart."));
    }

    const settings = getTunnelSettings();

    if ((action === "start" || action === "restart") && !settings.tunnelToken) {
      return errorResponse(new Error("Tunnel token is not configured."));
    }

    let success = true;
    try {
      if (action === "start") {
        await startCloudflared(settings.tunnelToken);
      } else if (action === "stop") {
        await stopCloudflared();
      } else {
        await restartCloudflared(settings.tunnelToken);
      }
    } catch (err) {
      success = false;
      logger.warn("cloudflared", `Tunnel ${action} failed: ${err}`);
    }

    logAudit({
      userId: auth.userId,
      username: auth.username,
      action: success ? action : `${action}_failed`,
      category: "settings",
      targetType: "setting",
      targetName: "cloudflare-tunnel",
      ipAddress: getClientIp(req),
    });

    if (!success) {
      return errorResponse(new Error(`Tunnel ${action} failed. Check server logs for details.`));
    }

    return ok({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
