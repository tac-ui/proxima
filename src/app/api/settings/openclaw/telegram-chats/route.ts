import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";
import * as fs from "fs";
import * as path from "path";

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json();
    let botToken: string | undefined = body.botToken?.trim();

    // Fallback: read saved token from openclaw.json when none provided
    if (!botToken) {
      try {
        const dataDir = process.env.PXM_DATA_DIR || "/data";
        const configPath = path.join(dataDir, "openclaw", "openclaw.json");
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          botToken = config?.channels?.telegram?.botToken;
        }
      } catch { /* ignore */ }
    }

    if (!botToken) {
      return ok([]);
    }

    // Basic format validation to avoid sending arbitrary strings to Telegram
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      return errorResponse(new Error("Invalid bot token format"));
    }

    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getUpdates?limit=100`,
    );
    const data = await res.json();

    if (!data.ok) {
      return errorResponse(new Error(data.description || "Telegram API error"));
    }

    const chats = new Map<number, { id: number; type: string; title?: string; username?: string; firstName?: string }>();
    for (const update of data.result || []) {
      const msg = update.message || update.edited_message || update.channel_post;
      if (!msg) continue;
      if (msg.chat) {
        chats.set(msg.chat.id, {
          id: msg.chat.id,
          type: msg.chat.type,
          title: msg.chat.title,
          username: msg.chat.username,
          firstName: msg.chat.first_name,
        });
      }
      if (msg.from && !chats.has(msg.from.id)) {
        chats.set(msg.from.id, {
          id: msg.from.id,
          type: "private",
          username: msg.from.username,
          firstName: msg.from.first_name,
        });
      }
    }

    return ok(Array.from(chats.values()));
  } catch (err) {
    return errorResponse(err);
  }
}
