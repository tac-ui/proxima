import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getOpenClawSettings, saveOpenClawSettings, ensureGatewayToken, getOpenClawStatus, startOpenClaw, stopOpenClaw, restartOpenClaw } from "@server/services/openclaw";
import { logAudit, getClientIp } from "@server/services/audit";
import { logger } from "@server/lib/logger";

/** Mask an API key for safe display: show first 4 and last 4 chars. */
function maskKey(key?: string): string {
  if (!key || key.length < 10) return key ? "••••••••" : "";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function maskedResponse(settings: ReturnType<typeof getOpenClawSettings>) {
  return {
    ...settings,
    gatewayToken: settings.gatewayToken ? "••••••••" : "",
    models: {
      openaiApiKey: maskKey(settings.models.openaiApiKey),
      anthropicApiKey: maskKey(settings.models.anthropicApiKey),
      geminiApiKey: maskKey(settings.models.geminiApiKey),
      openrouterApiKey: maskKey(settings.models.openrouterApiKey),
    },
  };
}

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    return ok(maskedResponse(getOpenClawSettings()));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const body = await req.json();

    const current = getOpenClawSettings();
    const wasEnabled = current.enabled;
    const wasRunning = getOpenClawStatus().state === "running";

    // Build update payload — skip masked values
    const update: Partial<typeof current> = {};

    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (typeof body.gatewayPort === "number") update.gatewayPort = body.gatewayPort;

    // Gateway token: auto-generate if enabling for the first time
    if (typeof body.gatewayToken === "string" && !body.gatewayToken.includes("••")) {
      update.gatewayToken = body.gatewayToken;
    } else if (body.enabled && !current.gatewayToken) {
      update.gatewayToken = ensureGatewayToken();
    }

    // Models: only update keys that aren't masked
    if (body.models && typeof body.models === "object") {
      const models: Record<string, string | undefined> = {};
      for (const [key, val] of Object.entries(body.models)) {
        if (typeof val === "string" && val && !val.includes("••")) {
          models[key] = val;
        }
      }
      if (Object.keys(models).length > 0) {
        update.models = models as typeof current.models;
      }
    }

    const saved = saveOpenClawSettings(update);

    // Auto-manage gateway process
    try {
      const nowEnabled = saved.enabled;

      if (nowEnabled && !wasRunning) {
        // Enable + not running → start
        await startOpenClaw();
      } else if (nowEnabled && wasRunning) {
        // Settings changed while running → restart to pick up changes
        await restartOpenClaw();
      } else if (!nowEnabled && wasRunning) {
        // Disabled → stop
        await stopOpenClaw();
      }
    } catch (err) {
      logger.warn("openclaw", `Gateway management after settings save: ${err}`);
    }

    logAudit({
      userId: auth.userId,
      username: auth.username,
      action: "update",
      category: "settings",
      targetType: "setting",
      targetName: "openclaw",
      ipAddress: getClientIp(req),
    });

    return ok(maskedResponse(saved));
  } catch (err) {
    return errorResponse(err);
  }
}
