import { getDb, schema } from "../db/index";
import { eq } from "drizzle-orm";
import { dbHelpers } from "../db/index";
import { logger } from "../lib/logger";
import os from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationEventType =
  | "stack.down"
  | "stack.started"
  | "stack.stopped"
  | "health.failed"
  | "health.recovered"
  | "deploy.success"
  | "deploy.failed"
  | "script.success"
  | "script.failed";

export interface NotificationEvent {
  type: NotificationEventType;
  target: string;
  message?: string;
  /** Domain string used to match against channel domainFilter. */
  domain?: string;
  /** If set, only send to these specific channel IDs. */
  channelIds?: number[];
}

interface SlackConfig {
  webhookUrl: string;
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

// ---------------------------------------------------------------------------
// Event metadata
// ---------------------------------------------------------------------------

const EVENT_META: Record<NotificationEventType, { icon: string; label: string }> = {
  "stack.down":       { icon: "\u{1F534}", label: "Stack Down" },
  "stack.started":    { icon: "\u{1F7E2}", label: "Stack Started" },
  "stack.stopped":    { icon: "\u{1F7E0}", label: "Stack Stopped" },
  "health.failed":    { icon: "\u{1F534}", label: "Health Check Failed" },
  "health.recovered": { icon: "\u{1F7E2}", label: "Health Check Recovered" },
  "deploy.success":   { icon: "\u{2705}",  label: "Deploy Succeeded" },
  "deploy.failed":    { icon: "\u{274C}",  label: "Deploy Failed" },
  "script.success":   { icon: "\u{2705}",  label: "Script Succeeded" },
  "script.failed":    { icon: "\u{274C}",  label: "Script Failed" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInstanceName(): string {
  try {
    const db = getDb();
    const name = dbHelpers.getSetting(db, "branding:appName")?.value;
    if (name) return name;
  } catch { /* ignore */ }
  return os.hostname();
}

function formatTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function buildDescription(event: NotificationEvent, meta: { icon: string; label: string }): string {
  if (event.message) return event.message;
  switch (event.type) {
    case "stack.down":       return `Stack "${event.target}" went down unexpectedly.`;
    case "stack.started":    return `Stack "${event.target}" has been started successfully.`;
    case "stack.stopped":    return `Stack "${event.target}" has been stopped.`;
    case "health.failed":    return `Health check failed for "${event.target}".`;
    case "health.recovered": return `Health check recovered for "${event.target}".`;
    case "deploy.success":   return `Stack "${event.target}" deployed successfully.`;
    case "deploy.failed":    return `Deployment failed for stack "${event.target}".`;
    case "script.success":   return `Script "${event.target}" executed successfully.`;
    case "script.failed":    return `Script "${event.target}" execution failed.`;
    default:                 return `Event on "${event.target}".`;
  }
}

// ---------------------------------------------------------------------------
// Slack delivery
// ---------------------------------------------------------------------------

async function sendSlack(config: SlackConfig, event: NotificationEvent): Promise<void> {
  const meta = EVENT_META[event.type];
  const description = buildDescription(event, meta);
  const instance = getInstanceName();
  const timestamp = formatTimestamp();

  const payload = {
    text: `${meta.icon} ${meta.label}: ${description}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${meta.icon} *${meta.label}*\n${description}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Server: ${instance} | ${timestamp}`,
          },
        ],
      },
    ],
  };

  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook returned ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Telegram delivery
// ---------------------------------------------------------------------------

async function sendTelegram(config: TelegramConfig, event: NotificationEvent): Promise<void> {
  const meta = EVENT_META[event.type];
  const description = buildDescription(event, meta);
  const instance = getInstanceName();
  const timestamp = formatTimestamp();

  const text = [
    `${meta.icon} <b>${meta.label}</b>`,
    description,
    `<i>Server: ${instance} | ${timestamp}</i>`,
  ].join("\n");

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML" }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Telegram API returned ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a notification to all enabled channels. Fire-and-forget safe.
 */
export async function notify(event: NotificationEvent): Promise<void> {
  let channels: (typeof schema.notificationChannels.$inferSelect)[];
  try {
    const db = getDb();
    channels = db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.enabled, true))
      .all();
  } catch (err) {
    logger.error("notification", `Failed to load channels: ${err}`);
    return;
  }

  if (channels.length === 0) return;

  // Filter by explicit channel IDs if specified
  const candidates = event.channelIds?.length
    ? channels.filter((ch) => event.channelIds!.includes(ch.id))
    : channels;

  // Filter channels by domain if the channel has a domainFilter configured
  const matched = candidates.filter((ch) => {
    let domains: string[];
    try { domains = JSON.parse(ch.domainFilter); } catch { domains = []; }
    if (!Array.isArray(domains) || domains.length === 0) return true; // no filter → all events
    if (!event.domain) return false; // channel has filter but event has no domain → skip
    const target = event.domain.toLowerCase();
    return domains.some((d) => {
      const dl = d.toLowerCase();
      return target === dl || target.endsWith("/" + dl) || target.endsWith("." + dl) || target.includes("://" + dl);
    });
  });

  if (matched.length === 0) return;

  await Promise.allSettled(
    matched.map(async (ch) => {
      try {
        const config = JSON.parse(ch.config);
        if (ch.type === "slack") {
          await sendSlack(config as SlackConfig, event);
        } else if (ch.type === "telegram") {
          await sendTelegram(config as TelegramConfig, event);
        }
      } catch (err) {
        logger.error("notification", `Failed to send to channel "${ch.name}" (${ch.type}): ${err}`);
      }
    }),
  );
}

/**
 * Send a test notification to a specific channel.
 */
export async function sendTestNotification(channelId: number): Promise<void> {
  const db = getDb();
  const ch = db
    .select()
    .from(schema.notificationChannels)
    .where(eq(schema.notificationChannels.id, channelId))
    .get();

  if (!ch) throw new Error("Channel not found");

  const testEvent: NotificationEvent = {
    type: "deploy.success",
    target: "test",
    message: "This is a test notification from Proxima.",
  };

  let config;
  try { config = JSON.parse(ch.config); }
  catch { throw new Error("Channel configuration is corrupt"); }

  if (ch.type === "slack") {
    await sendSlack(config as SlackConfig, testEvent);
  } else if (ch.type === "telegram") {
    await sendTelegram(config as TelegramConfig, testEvent);
  } else {
    throw new Error(`Unknown channel type: ${ch.type}`);
  }
}
