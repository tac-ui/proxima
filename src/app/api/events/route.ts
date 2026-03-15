import { type NextRequest } from "next/server";
import { verifyToken } from "@server/services/auth";
import { getDb, dbHelpers } from "@server/db/index";
import { ensureDb } from "../_lib/db";
import { eventBus, type SSEEvent } from "../_lib/event-bus";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // EventSource doesn't support custom headers, so token comes via query param
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: "Missing token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    ensureDb();
    const payload = verifyToken(token);
    const db = getDb();
    const user = dbHelpers.getUserById(db, payload.userId);

    if (!user || user.username !== payload.username) {
      return new Response(JSON.stringify({ ok: false, error: "User not found or token mismatch" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid or expired token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`)
      );

      const handler = (event: SSEEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        } catch {
          // Client may have disconnected
        }
      };

      eventBus.on("broadcast", handler);

      // Clean up on client disconnect
      req.signal.addEventListener("abort", () => {
        eventBus.off("broadcast", handler);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
