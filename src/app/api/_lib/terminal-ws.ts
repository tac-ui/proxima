import type { IncomingMessage } from "node:http";
import { WebSocket } from "ws";
import { verifyToken } from "@server/services/auth";
import { getDb, dbHelpers } from "@server/db/index";
import { Terminal, InteractiveTerminal } from "@server/services/terminal";
import type { AppSocket } from "@server/services/terminal";

// ---------------------------------------------------------------------------
// WebSocketClient – mimics AppSocket so Terminal can emit to WebSocket clients
// ---------------------------------------------------------------------------

class WebSocketClient {
  id: string;
  connected: boolean = true;
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.id = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.ws = ws;
    ws.on("close", () => {
      this.connected = false;
    });
  }

  emit(event: string, ...args: unknown[]): this {
    if (!this.connected) return this;
    try {
      if (event === "terminalWrite") {
        this.ws.send(JSON.stringify({ type: "write", terminalId: args[0], data: args[1] }));
      } else if (event === "terminalExit") {
        this.ws.send(JSON.stringify({ type: "exit", terminalId: args[0], exitCode: args[1] }));
      }
    } catch {
      // Ignore send errors on closed connections
    }
    return this;
  }

  // Stub methods that Socket.IO interface may expect
  on(): this { return this; }
  off(): this { return this; }
  join(): this { return this; }
  to(): this { return this; }
}

// ---------------------------------------------------------------------------
// handleTerminalConnection
// ---------------------------------------------------------------------------

export async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
): Promise<void> {
  // Authentication via first message (not URL query string).
  // Client must send { type: "auth", token: "..." } within 5 seconds.
  let authenticated = false;

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      console.error("[terminal-ws] Auth timeout, closing WebSocket");
      ws.close(1008, "Auth timeout");
    }
  }, 5000);

  ws.once("message", async (raw: Buffer | string) => {
    let msg: { type: string; token?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      clearTimeout(authTimeout);
      ws.close(1008, "Invalid auth message");
      return;
    }

    if (msg.type !== "auth" || !msg.token) {
      clearTimeout(authTimeout);
      ws.close(1008, "Expected auth message");
      return;
    }

    const token = msg.token;

    try {
      const payload = verifyToken(token);
      const db = getDb();
      const user = dbHelpers.getUserById(db, payload.userId);

      if (!user || user.username !== payload.username) {
        console.error("[terminal-ws] User not found or token mismatch");
        clearTimeout(authTimeout);
        ws.close(1008, "User not found or token mismatch");
        return;
      }

      if (user.role !== "admin" && user.role !== "manager") {
        console.error("[terminal-ws] Insufficient role:", user.role);
        clearTimeout(authTimeout);
        ws.close(1008, "Admin access required");
        return;
      }
      console.log("[terminal-ws] Auth OK for user:", user.username);
    } catch (err) {
      console.error("[terminal-ws] Token verification failed:", err);
      clearTimeout(authTimeout);
      ws.close(1008, "Invalid or expired token");
      return;
    }

    clearTimeout(authTimeout);
    authenticated = true;

    // Send auth success response
    ws.send(JSON.stringify({ type: "auth", status: "ok" }));

    // Attach normal message handler after successful auth
    const client = new WebSocketClient(ws) as unknown as AppSocket;

    ws.on("message", (raw: Buffer | string) => {
      let msg: { type: string; terminalId?: string; data?: string; rows?: number; cols?: number };

      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const { type, terminalId } = msg;

      if (!terminalId) return;

      if (type === "join") {
        const terminal = Terminal.getTerminal(terminalId);
        console.log(`[terminal-ws] join ${terminalId} — found: ${!!terminal}, total terminals: ${Terminal.getAllTerminals().length}`);
        if (!terminal) {
          ws.send(JSON.stringify({ type: "error", terminalId, error: "Terminal not found" }));
          return;
        }
        terminal.join(client);
        const buffer = terminal.getBuffer();
        console.log(`[terminal-ws] Sending buffer (${buffer.length} chars) for ${terminalId}`);
        ws.send(JSON.stringify({ type: "buffer", terminalId, data: buffer }));

        // If the terminal already exited (late join), immediately send exit event
        if (terminal.exitInfo) {
          ws.send(JSON.stringify({ type: "exit", terminalId, exitCode: terminal.exitInfo.exitCode }));
        }
      } else if (type === "input") {
        const terminal = Terminal.getTerminal(terminalId);
        if (terminal && "write" in terminal && typeof (terminal as InteractiveTerminal).write === "function" && msg.data !== undefined) {
          (terminal as InteractiveTerminal).write(msg.data);
        }
      } else if (type === "resize") {
        const terminal = Terminal.getTerminal(terminalId);
        if (terminal) {
          if (msg.rows !== undefined) terminal.rows = msg.rows;
          if (msg.cols !== undefined) terminal.cols = msg.cols;
        }
      }
    });

    ws.on("close", () => {
      // Leave all terminals this client was subscribed to
      for (const terminal of Terminal.getAllTerminals()) {
        terminal.leave(client);
      }
    });
  });
}
