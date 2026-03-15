import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import {
  getMaskedTunnelSettings,
  saveTunnelSettings,
  getTunnelSettings,
} from "@server/services/cloudflare";
import { startCloudflared, stopCloudflared, restartCloudflared, getCloudflaredStatus, parseTunnelToken } from "@server/services/cloudflared";
import { logger } from "@server/lib/logger";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);
    return ok(getMaskedTunnelSettings());
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const body = await req.json();

    // If tunnelToken looks masked, keep the existing one
    const existing = getTunnelSettings();
    const tunnelToken =
      typeof body.tunnelToken === "string" && !body.tunnelToken.includes("••")
        ? body.tunnelToken
        : existing.tunnelToken;

    const newEnabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;

    // Auto-extract tunnelId from token
    let tunnelId = existing.tunnelId;
    if (tunnelToken && tunnelToken !== existing.tunnelToken) {
      try {
        const creds = parseTunnelToken(tunnelToken);
        tunnelId = creds.tunnelId;
      } catch (err) {
        logger.warn("cloudflare", `Failed to parse tunnel token: ${err}`);
      }
    }

    saveTunnelSettings({
      enabled: newEnabled,
      tunnelId,
      tunnelName: "",
      accountId: "",
      tunnelToken,
    });

    // Manage cloudflared container
    try {
      if (newEnabled && tunnelToken) {
        const status = await getCloudflaredStatus();
        if (status.state === "running" && tunnelToken !== existing.tunnelToken) {
          await restartCloudflared(tunnelToken);
        } else if (status.state !== "running") {
          await startCloudflared(tunnelToken);
        }
      } else if (!newEnabled) {
        await stopCloudflared();
      }
    } catch (err) {
      logger.warn("cloudflared", `Container management failed: ${err}`);
    }

    logAudit({ userId: auth.userId, username: auth.username, action: "update", category: "settings", targetType: "setting", targetName: "cloudflare-tunnel", ipAddress: getClientIp(req) });
    return ok(getMaskedTunnelSettings());
  } catch (err) {
    return errorResponse(err);
  }
}
