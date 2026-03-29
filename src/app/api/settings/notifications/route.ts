import { type NextRequest } from "next/server";
import { requireAuth, requireManager, errorResponse, ok } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";
import { getDb, schema } from "@server/db/index";
import { logAudit, getClientIp } from "@server/services/audit";

export async function GET(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const db = getDb();
    const channels = db.select().from(schema.notificationChannels).all();
    // Redact sensitive config (webhook URLs, bot tokens)
    const safe = channels.map((ch) => {
      let configSummary = "";
      try {
        const parsed = JSON.parse(ch.config);
        if (ch.type === "slack" && parsed.webhookUrl) {
          configSummary = parsed.webhookUrl.slice(0, 40) + "...";
        } else if (ch.type === "telegram" && parsed.chatId) {
          configSummary = `Chat: ${parsed.chatId}`;
        }
      } catch { /* ignore */ }
      return { id: ch.id, type: ch.type, name: ch.name, enabled: ch.enabled, configSummary, createdAt: ch.createdAt };
    });
    return ok(safe);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    const auth = requireManager(req);
    const db = getDb();
    const body = await req.json() as { type: string; name: string; config: Record<string, string>; enabled?: boolean };

    if (!body.type || !body.name || !body.config) {
      return errorResponse(new Error("Missing required fields"), "type, name, and config are required");
    }
    if (body.type !== "slack" && body.type !== "telegram") {
      return errorResponse(new Error("Invalid type"), "type must be 'slack' or 'telegram'");
    }

    // Validate config based on type
    if (body.type === "slack") {
      const url = body.config.webhookUrl;
      if (!url || !url.startsWith("https://hooks.slack.com/")) {
        return errorResponse(new Error("Invalid Slack webhook URL"), "Slack webhook URL must start with https://hooks.slack.com/");
      }
    } else if (body.type === "telegram") {
      const { botToken, chatId } = body.config;
      if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
        return errorResponse(new Error("Invalid Telegram bot token"), "Invalid Telegram bot token format");
      }
      if (!chatId) {
        return errorResponse(new Error("Missing chat ID"), "Telegram chat ID is required");
      }
    }

    const result = db.insert(schema.notificationChannels).values({
      type: body.type,
      name: body.name,
      config: JSON.stringify(body.config),
      enabled: body.enabled !== false,
    }).returning().get();

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "notification", targetType: "notification_channel", targetName: body.name, ipAddress: getClientIp(req) });
    return ok(result);
  } catch (err) {
    return errorResponse(err);
  }
}
