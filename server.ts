import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, WebSocket as WsClient } from "ws";
import { ensureDb } from "./src/app/api/_lib/db";
import { getConfig, initHostDataDir } from "./src/server/lib/config";
import { NetworkDiscovery } from "./src/server/services/network-discovery";
import { broadcast } from "./src/app/api/_lib/event-bus";
import { handleTerminalConnection } from "./src/app/api/_lib/terminal-ws";
import { logger } from "./src/server/lib/logger";
import { getTunnelSettings } from "./src/server/services/cloudflare";
import { getCloudflaredStatus, startCloudflared, checkAndFixNetwork } from "./src/server/services/cloudflared";
import { syncAutoManaged } from "./src/server/services/managed-service";
import { autoStartScripts } from "./src/server/services/auto-start";
import { startHealthCheckScheduler } from "./src/server/services/health-check";
import { autoStartOpenClaw, shutdownOpenClaw, getOpenClawSettings } from "./src/server/services/openclaw";

const dev = process.env.NODE_ENV !== "production";

async function main() {
  // Auto-detect host data directory for Docker bind mounts
  await initHostDataDir();

  // Initialize database and required directories
  ensureDb();

  // Auto-recover cloudflared container if tunnel is enabled
  try {
    const tunnel = getTunnelSettings();
    if (tunnel.enabled && tunnel.tunnelToken) {
      const cfdStatus = await getCloudflaredStatus();
      if (cfdStatus.state !== "running") {
        await startCloudflared(tunnel.tunnelToken);
        logger.info("server", "Cloudflared container auto-started");
      } else {
        // Fix network mismatch if cloudflared is running on wrong network
        await checkAndFixNetwork();
      }
    }
  } catch (err) {
    logger.warn("server", `Cloudflared auto-recovery failed: ${err}`);
  }

  // Sync auto-managed services (register stack containers)
  syncAutoManaged();

  // Auto-start scripts marked with autoStart flag
  autoStartScripts();

  // Start scheduled health checks
  startHealthCheckScheduler();

  // Auto-start OpenClaw gateway if enabled
  autoStartOpenClaw();

  // Start Docker event watcher for auto-discovery (debounced to avoid rapid re-renders)
  try {
    const discovery = new NetworkDiscovery();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    discovery.watchEvents(({ action }) => {
      if (action === "start" || action === "stop" || action === "die" || action === "destroy") {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            const services = await discovery.discoverServices();
            broadcast({ type: "discoveredServices", data: services });
          } catch (err) {
            logger.warn("server", `Failed to refresh discovered services: ${err}`);
          }
        }, 2000);
      }
    });
    logger.info("server", "Docker event watcher started");
  } catch (err) {
    logger.warn("server", `Docker event watcher could not start (Docker may not be available): ${err}`);
  }

  const config = getConfig();

  const app = next({ dev });
  const handle = app.getRequestHandler();

  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  // WebSocket server (noServer – we handle the upgrade manually)
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws, req) => {
    handleTerminalConnection(ws, req).catch((err) => {
      logger.error("server", `Terminal WebSocket error: ${err}`);
      ws.close(1011, "Internal server error");
    });
  });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/");
    logger.info("server", `WebSocket upgrade request: ${pathname}`);

    if (pathname === "/api/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        logger.debug("server", "WebSocket upgrade complete, emitting connection");
        wss.emit("connection", ws, req);
      });
    } else if (pathname === "/api/openclaw/ws") {
      // Proxy WebSocket to OpenClaw gateway on localhost (so 20242 doesn't need to be exposed)
      try {
        const settings = getOpenClawSettings();
        const port = settings.gatewayPort || 20242;
        const upstreamUrl = `ws://127.0.0.1:${port}`;

        // Accept the browser upgrade immediately so the client sees a stable
        // WebSocket even while the gateway is still booting. Messages from
        // the client are queued until the upstream connection is established.
        wss.handleUpgrade(req, socket, head, (client) => {
          const messageQueue: { data: Buffer; isBinary: boolean }[] = [];
          let upstream: WsClient | null = null;
          let upstreamOpen = false;
          let clientClosed = false;

          // --- Ping/pong keepalive ----------------------------------------
          // WS protocol ping frames. The browser auto-pongs, so we can
          // detect dead sockets by tracking `lastPongAt`. This catches
          // middleboxes (Docker bridge, reverse proxies, firewalls) that
          // silently drop idle TCP — they'd otherwise leave us with a
          // half-open connection until the next send attempt.
          const PING_INTERVAL_MS = 25_000;
          const PONG_TIMEOUT_MS = 45_000;
          let clientAlive = true;
          let upstreamAlive = true;

          client.on("pong", () => { clientAlive = true; });

          const pingInterval = setInterval(() => {
            if (clientClosed) return;
            // Client side
            if (!clientAlive) {
              logger.warn("server", "OpenClaw WS client pong timeout — closing");
              try { client.close(1011, "ping timeout"); } catch { /* ignore */ }
              clearInterval(pingInterval);
              return;
            }
            clientAlive = false;
            try { client.ping(); } catch { /* ignore */ }

            // Upstream side
            if (upstream && upstream.readyState === WsClient.OPEN) {
              if (!upstreamAlive) {
                logger.warn("server", "OpenClaw WS upstream pong timeout — closing");
                try { upstream.close(); } catch { /* ignore */ }
                return;
              }
              upstreamAlive = false;
              try { upstream.ping(); } catch { /* ignore */ }
            }
          }, PING_INTERVAL_MS);

          // Pong timeout guard (if the remote never pongs at all)
          const pongWatchdog = setInterval(() => {
            if (clientClosed) return;
            if (!clientAlive) {
              // Will be handled on next ping tick; keep this as an explicit
              // fast path so a totally silent remote still gets closed.
            }
          }, PONG_TIMEOUT_MS);

          const cleanupKeepalive = () => {
            clearInterval(pingInterval);
            clearInterval(pongWatchdog);
          };
          // ----------------------------------------------------------------

          client.on("message", (data, isBinary) => {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            if (upstream && upstreamOpen && upstream.readyState === WsClient.OPEN) {
              upstream.send(buf, { binary: isBinary });
            } else {
              messageQueue.push({ data: buf, isBinary });
            }
          });
          client.on("close", () => {
            clientClosed = true;
            cleanupKeepalive();
            try { upstream?.close(); } catch { /* ignore */ }
          });
          client.on("error", () => {
            clientClosed = true;
            cleanupKeepalive();
            try { upstream?.close(); } catch { /* ignore */ }
          });

          // Retry upstream connection during gateway boot. 30 retries ×
          // 500ms = 15s window, which covers openclaw's typical cold-start
          // (load config → resolve auth → start → bind port).
          const MAX_RETRIES = 30;
          const RETRY_INTERVAL_MS = 500;
          let retries = 0;
          let loggedProxyStart = false;

          const tryConnectUpstream = () => {
            if (clientClosed) return;
            if (!loggedProxyStart) {
              loggedProxyStart = true;
              logger.info("server", `Proxying OpenClaw WS to ${upstreamUrl}`);
            }

            const attempt = new WsClient(upstreamUrl, {
              headers: { origin: `http://127.0.0.1:${port}` },
            });

            attempt.once("open", () => {
              if (clientClosed) { try { attempt.close(); } catch { /* ignore */ } return; }
              upstream = attempt;
              upstreamOpen = true;
              // Reset alive flags now that the upstream is live so the first
              // tick of the ping interval doesn't trip the pong-timeout.
              upstreamAlive = true;

              // Flush any frames the client sent while we were retrying.
              while (messageQueue.length > 0) {
                const msg = messageQueue.shift()!;
                attempt.send(msg.data, { binary: msg.isBinary });
              }

              attempt.on("pong", () => { upstreamAlive = true; });

              attempt.on("message", (data, isBinary) => {
                if (client.readyState === WsClient.OPEN) client.send(data, { binary: isBinary });
              });
              attempt.on("close", () => { try { client.close(); } catch { /* ignore */ } });
              attempt.on("error", (err) => {
                logger.warn("server", `OpenClaw WS upstream error: ${err.message}`);
                try { client.close(1011, "Upstream error"); } catch { /* ignore */ }
              });
            });

            attempt.once("error", (err) => {
              // Swallow the error; we'll retry unless we're out of attempts.
              attempt.removeAllListeners();
              try { attempt.close(); } catch { /* ignore */ }

              if (clientClosed) return;
              retries++;
              if (retries >= MAX_RETRIES) {
                logger.warn(
                  "server",
                  `OpenClaw WS upstream unavailable after ${(retries * RETRY_INTERVAL_MS) / 1000}s: ${err.message}`,
                );
                try { client.close(1013, "Gateway unavailable"); } catch { /* ignore */ }
                return;
              }
              setTimeout(tryConnectUpstream, RETRY_INTERVAL_MS);
            });
          };

          tryConnectUpstream();
        });
      } catch (err) {
        logger.error("server", `OpenClaw WS proxy setup failed: ${err}`);
        socket.destroy();
      }
    } else {
      // Let Next.js handle HMR WebSocket upgrades in dev
      // For anything else, destroy the socket
      if (!dev) {
        socket.destroy();
      }
    }
  });

  httpServer.listen(config.port, config.hostname, () => {
    logger.info("server", `Listening on http://${config.hostname}:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("server", `Received ${signal}, shutting down...`);
    await shutdownOpenClaw();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
