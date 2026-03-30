import { type NextRequest } from "next/server";
import { requireManager, errorResponse, ok } from "../../../_lib/auth";
import { ensureDb } from "../../../_lib/db";

interface TelegramChat {
  chatId: string;
  title: string;
  type: string;
  lastMessage?: string;
  lastMessageDate?: string;
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireManager(req);
    const body = await req.json() as { botToken: string };
    const { botToken } = body;

    if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      return errorResponse(new Error("Invalid bot token"), "Invalid Telegram bot token format");
    }

    // Verify bot token via getMe
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!meRes.ok) {
      return errorResponse(new Error("Invalid bot token"), "Bot token is invalid or expired");
    }
    const meData = await meRes.json() as { ok: boolean; result?: { first_name: string; username: string } };
    if (!meData.ok || !meData.result) {
      return errorResponse(new Error("Invalid bot token"), "Bot token verification failed");
    }

    // Fetch recent updates to discover chats
    const updatesRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!updatesRes.ok) {
      return errorResponse(new Error("Failed to fetch updates"), "Could not fetch Telegram updates");
    }
    const updatesData = await updatesRes.json() as {
      ok: boolean;
      result?: {
        message?: {
          chat: { id: number; title?: string; first_name?: string; last_name?: string; type: string };
          text?: string;
          date: number;
        };
      }[];
    };

    // Deduplicate chats, keep latest message per chat
    const chatMap = new Map<string, TelegramChat>();
    if (updatesData.ok && updatesData.result) {
      for (const update of updatesData.result) {
        const msg = update.message;
        if (!msg?.chat) continue;
        const chatId = String(msg.chat.id);
        const existing = chatMap.get(chatId);
        const msgDate = new Date(msg.date * 1000);

        if (!existing || (existing.lastMessageDate && msgDate > new Date(existing.lastMessageDate))) {
          chatMap.set(chatId, {
            chatId,
            title: msg.chat.title || [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(" ") || chatId,
            type: msg.chat.type,
            lastMessage: msg.text?.slice(0, 100),
            lastMessageDate: msgDate.toISOString(),
          });
        }
      }
    }

    return ok({
      bot: { name: meData.result.first_name, username: meData.result.username },
      chats: Array.from(chatMap.values()).sort((a, b) =>
        (b.lastMessageDate ?? "").localeCompare(a.lastMessageDate ?? ""),
      ),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
