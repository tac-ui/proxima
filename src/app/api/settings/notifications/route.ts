import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../_lib/auth";
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
      let domainFilter: string[] = [];
      try { domainFilter = JSON.parse(ch.domainFilter); } catch { /* ignore */ }
      return { id: ch.id, type: ch.type, name: ch.name, enabled: ch.enabled, configSummary, domainFilter, createdAt: ch.createdAt };
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
    const body = await req.json() as { type: string; name: string; config: Record<string, string>; enabled?: boolean; domainFilter?: string[] };

    if (!body.type || !body.name || !body.config) {
      return errorResponse(new Error("Missing required fields"), "type, name, and config are required");
    }
    if (body.type !== "slack" && body.type !== "telegram" && body.type !== "discord") {
      return errorResponse(new Error("Invalid type"), "type must be 'slack', 'telegram', or 'discord'");
    }

    // Validate config based on type
    if (body.type === "slack") {
      const url = body.config.webhookUrl;
      if (!url || !url.startsWith("https://hooks.slack.com/")) {
        return errorResponse(new Error("Invalid Slack webhook URL"), "Slack webhook URL must start with https://hooks.slack.com/");
      }
    } else if (body.type === "discord") {
      const url = body.config.webhookUrl;
      if (!url || !url.startsWith("https://discord.com/api/webhooks/")) {
        return errorResponse(new Error("Invalid Discord webhook URL"), "Discord webhook URL must start with https://discord.com/api/webhooks/");
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
      domainFilter: JSON.stringify(Array.isArray(body.domainFilter) ? body.domainFilter : []),
    }).returning().get();

    logAudit({ userId: auth.userId, username: auth.username, action: "create", category: "notification", targetType: "notification_channel", targetName: body.name, ipAddress: getClientIp(req) });
    let domainFilter: string[] = [];
    try { domainFilter = JSON.parse(result.domainFilter); } catch { /* ignore */ }
    return ok({ id: result.id, type: result.type, name: result.name, enabled: result.enabled, domainFilter, createdAt: result.createdAt });
  } catch (err) {
    return errorResponse(err);
  }
}
