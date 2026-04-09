import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
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
import { autoStartOpenClaw, shutdownOpenClaw } from "./src/server/services/openclaw";

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
    logger.debug("server", `WebSocket upgrade request: ${pathname}`);

    if (pathname === "/api/terminal") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        logger.debug("server", "WebSocket upgrade complete, emitting connection");
        wss.emit("connection", ws, req);
      });
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
