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
  // Mask all fields ending in ApiKey or containing Token
  const maskedModels: Record<string, string> = {};
  for (const [key, val] of Object.entries(settings.models)) {
    maskedModels[key] = key.endsWith("ApiKey") || key.endsWith("Token") ? maskKey(val) : (val ?? "");
  }
  return {
    ...settings,
    gatewayToken: settings.gatewayToken ? "••••••••" : "",
    githubToken: settings.githubToken ? maskKey(settings.githubToken) : "",
    models: maskedModels,
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
    const wasRunning = getOpenClawStatus().state === "running";

    // Build update payload — skip masked values
    const update: Partial<typeof current> = {};

    if (typeof body.enabled === "boolean") update.enabled = body.enabled;
    if (typeof body.gatewayPort === "number") update.gatewayPort = body.gatewayPort;

    // SSH key — selects a Proxima-registered Git SSH key. The openclaw
    // service injects `GIT_SSH_COMMAND` with this key's path when it forks
    // the gateway, so the agent's git operations authenticate correctly.
    if (body.sshKeyId === null) {
      update.sshKeyId = null;
    } else if (typeof body.sshKeyId === "number" && Number.isFinite(body.sshKeyId)) {
      update.sshKeyId = body.sshKeyId;
    }

    // Git commit identity — injected as GIT_AUTHOR_* / GIT_COMMITTER_*
    // env vars on gateway fork. Empty string is allowed (clears the field).
    if (typeof body.gitUserName === "string") {
      update.gitUserName = body.gitUserName.trim();
    }
    if (typeof body.gitUserEmail === "string") {
      update.gitUserEmail = body.gitUserEmail.trim();
    }

    // GitHub PAT — injected as GH_TOKEN / GITHUB_TOKEN for `gh` CLI + API.
    // Skip values containing the mask marker so re-saving the form without
    // re-typing the token doesn't wipe the stored value.
    if (typeof body.githubToken === "string" && !body.githubToken.includes("••")) {
      update.githubToken = body.githubToken.trim();
    }

    // Gateway token: auto-generate if enabling for the first time
    if (typeof body.gatewayToken === "string" && !body.gatewayToken.includes("••")) {
      update.gatewayToken = body.gatewayToken;
    } else if (body.enabled && !current.gatewayToken) {
      update.gatewayToken = ensureGatewayToken();
    }

    // Models: accept non-masked strings; empty string means remove the key
    if (body.models && typeof body.models === "object") {
      const models: Record<string, string | undefined> = {};
      let hasChange = false;
      for (const [key, val] of Object.entries(body.models)) {
        if (typeof val === "string" && !val.includes("••")) {
          models[key] = val; // may be "" to signal removal
          hasChange = true;
        }
      }
      if (hasChange) {
        update.models = models as typeof current.models;
      }
    }

    const saved = saveOpenClawSettings(update);

    // Auto-manage gateway process. API keys live in env vars passed to
    // fork() — the running gateway can't pick up new env without a restart,
    // so any models change must force a restart when enabled.
    const modelsChanged = update.models !== undefined;
    try {
      const nowEnabled = saved.enabled;

      if (nowEnabled && !wasRunning) {
        // Enable + not running → start (with the new env)
        logger.info("openclaw", `Settings update triggered start (modelsChanged=${modelsChanged})`);
        await startOpenClaw();
      } else if (nowEnabled && wasRunning) {
        // Settings changed while running → restart to pick up changes.
        // This is the only way new API keys / model config reach the child.
        logger.info("openclaw", `Settings update triggered restart (modelsChanged=${modelsChanged})`);
        await restartOpenClaw();
      } else if (!nowEnabled && wasRunning) {
        // Disabled → stop
        logger.info("openclaw", "Settings update triggered stop (disabled)");
        await stopOpenClaw();
      }
    } catch (err) {
      logger.warn("openclaw", `Gateway management after settings save failed: ${err}`);
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
