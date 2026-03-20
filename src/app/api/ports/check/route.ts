import { type NextRequest } from "next/server";
import { createConnection } from "node:net";
import { requireAuth, errorResponse, ok, ValidationError } from "../../_lib/auth";
import { ensureDb } from "../../_lib/db";

/** Check if a TCP port is reachable. */
function checkPort(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    ensureDb();
    requireAuth(req);

    const body = await req.json();
    const { ports } = body;

    if (!Array.isArray(ports) || ports.length === 0) {
      throw new ValidationError("ports array is required");
    }

    // Limit to 20 ports per request
    const portsToCheck = ports.slice(0, 20) as { host?: string; port: number }[];

    const results: Record<number, boolean> = {};
    await Promise.all(
      portsToCheck.map(async (p) => {
        const host = p.host || "127.0.0.1";
        const port = typeof p.port === "number" ? p.port : parseInt(String(p.port), 10);
        if (isNaN(port) || port <= 0 || port > 65535) return;
        results[port] = await checkPort(host, port);
      }),
    );

    return ok({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
