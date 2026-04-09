import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok, ValidationError } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import { startOpenClaw, stopOpenClaw, restartOpenClaw, getOpenClawSettings } from "@server/services/openclaw";
import { logAudit, getClientIp } from "@server/services/audit";
import { logger } from "@server/lib/logger";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const body = await req.json();
    const action = body.action as string;

    if (!["start", "stop", "restart"].includes(action)) {
      throw new ValidationError("Invalid action. Must be start, stop, or restart.");
    }

    const settings = getOpenClawSettings();

    if (action === "start" || action === "restart") {
      if (!settings.enabled) {
        throw new ValidationError("OpenClaw is not enabled. Enable it in settings first.");
      }
    }

    try {
      if (action === "start") {
        await startOpenClaw();
      } else if (action === "stop") {
        await stopOpenClaw();
      } else {
        await restartOpenClaw();
      }
    } catch (err) {
      logger.error("openclaw", `Container ${action} failed: ${err}`);
      return ok({ success: false, error: err instanceof Error ? err.message : String(err) });
    }

    logAudit({
      userId: auth.userId,
      username: auth.username,
      action,
      category: "settings",
      targetType: "service",
      targetName: "openclaw",
      ipAddress: getClientIp(req),
    });

    return ok({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
