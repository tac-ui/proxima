import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import {
  getHealthCheckConfig,
  saveHealthCheckConfig,
  restartHealthCheckScheduler,
  type HealthCheckConfig,
} from "@server/services/health-check";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    return ok(getHealthCheckConfig());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = (await req.json()) as Partial<HealthCheckConfig>;

    const current = getHealthCheckConfig();
    const updated: HealthCheckConfig = {
      enabled: body.enabled ?? current.enabled,
      intervalMinutes: body.intervalMinutes ?? current.intervalMinutes,
      mode: body.mode ?? current.mode,
      scheduleTimes: body.scheduleTimes ?? current.scheduleTimes,
      messageTemplate: "messageTemplate" in body ? (body.messageTemplate || undefined) : current.messageTemplate,
      recoveryMessageTemplate: "recoveryMessageTemplate" in body ? (body.recoveryMessageTemplate || undefined) : current.recoveryMessageTemplate,
    };

    // Validate
    if (updated.intervalMinutes < 1) updated.intervalMinutes = 1;
    if (updated.scheduleTimes) {
      updated.scheduleTimes = updated.scheduleTimes.filter((t) => {
        const match = t.match(/^(\d{2}):(\d{2})$/);
        if (!match) return false;
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
      });
    }

    saveHealthCheckConfig(updated);
    restartHealthCheckScheduler();

    return ok(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
