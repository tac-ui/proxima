import Docker from "dockerode";
import { logger } from "../lib/logger";
import type { DiscoveredService, PortMapping, NetworkInfo, MountInfo } from "@/types";

// Common HTTP ports to look for when suggesting a proxy target
const HTTP_PORTS = [80, 8080, 3000, 3001, 8000, 8888, 5000, 4000, 9000];

export class NetworkDiscovery {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: "/var/run/docker.sock" });
  }

  async discoverServices(): Promise<DiscoveredService[]> {
    const containers = await this.docker.listContainers({ all: false });
    const services: DiscoveredService[] = [];

    for (const c of containers) {
      try {
        const { networks, ports, mounts } = await this.getContainerNetworkInfo(c.Id);

        // Extract service/stack names from compose labels
        const labels = c.Labels ?? {};
        const serviceName = labels["com.docker.compose.service"] ?? "";
        const stackName = labels["com.docker.compose.project"] ?? "";

        // Container name: strip leading slash
        const containerName = (c.Names?.[0] ?? "").replace(/^\//, "");

        // Primary internal IP from first available network
        const internalIp = networks[0]?.ipAddress ?? "";

        services.push({
          containerName,
          serviceName,
          stackName,
          internalIp,
          ports,
          networks: networks.map((n) => n.name),
          mounts,
        });
      } catch (err) {
        logger.warn("network-discovery", `Failed to inspect container ${c.Id}: ${err}`);
      }
    }

    logger.info("network-discovery", `Discovered ${services.length} service(s)`);
    return services;
  }

  async getContainerNetworkInfo(containerId: string): Promise<{
    networks: NetworkInfo[];
    ports: PortMapping[];
    mounts: MountInfo[];
  }> {
    const container = this.docker.getContainer(containerId);
    const info = await container.inspect();

    // Parse network info
    const networks: NetworkInfo[] = [];
    const rawNetworks = info.NetworkSettings?.Networks ?? {};
    for (const [name, net] of Object.entries(rawNetworks)) {
      const n = net as { IPAddress?: string; Gateway?: string };
      networks.push({
        name,
        ipAddress: n.IPAddress ?? "",
        gateway: n.Gateway ?? "",
      });
    }

    // Parse port mappings
    const ports: PortMapping[] = [];
    const rawPorts = info.NetworkSettings?.Ports ?? {};
    for (const [portProto, bindings] of Object.entries(rawPorts)) {
      if (!bindings) continue;
      const [containerPortStr, protocol] = portProto.split("/");
      const containerPort = parseInt(containerPortStr, 10);

      for (const binding of bindings as Array<{ HostPort?: string }>) {
        const hostPort = parseInt(binding.HostPort ?? "0", 10);
        if (hostPort > 0) {
          ports.push({
            hostPort,
            containerPort,
            protocol: protocol ?? "tcp",
          });
        }
      }
    }

    // Parse mount info
    const mounts: MountInfo[] = [];
    const rawMounts = (info.Mounts ?? []) as Array<{
      Type?: string;
      Source?: string;
      Destination?: string;
      Mode?: string;
      RW?: boolean;
    }>;
    for (const m of rawMounts) {
      mounts.push({
        type: m.Type ?? "bind",
        source: m.Source ?? "",
        destination: m.Destination ?? "",
        mode: m.Mode ?? "",
        rw: m.RW ?? true,
      });
    }

    // Sort for stable ordering across refreshes
    mounts.sort((a, b) => a.destination.localeCompare(b.destination));
    ports.sort((a, b) => a.containerPort - b.containerPort);

    return { networks, ports, mounts };
  }

  async suggestProxyTarget(stackName: string): Promise<{
    host: string;
    port: number;
    scheme: "http" | "https";
  } | null> {
    const containers = await this.docker.listContainers({ all: false });

    for (const c of containers) {
      const labels = c.Labels ?? {};
      if (labels["com.docker.compose.project"] !== stackName) continue;

      try {
        const { networks, ports } = await this.getContainerNetworkInfo(c.Id);

        // Try to find a container port that looks like HTTP
        const httpPort = ports.find((p) => HTTP_PORTS.includes(p.containerPort));
        if (httpPort && networks.length > 0) {
          const internalIp = networks[0].ipAddress;
          if (internalIp) {
            const scheme = httpPort.containerPort === 443 ? "https" : "http";
            logger.debug(
              "network-discovery",
              `Proxy suggestion for ${stackName}: ${scheme}://${internalIp}:${httpPort.containerPort}`
            );
            return { host: internalIp, port: httpPort.containerPort, scheme };
          }
        }

        // Fall back: any exposed port on the internal network
        if (ports.length > 0 && networks.length > 0) {
          const internalIp = networks[0].ipAddress;
          if (internalIp) {
            return { host: internalIp, port: ports[0].containerPort, scheme: "http" };
          }
        }
      } catch (err) {
        logger.warn("network-discovery", `Failed to inspect container for proxy suggestion: ${err}`);
      }
    }

    return null;
  }

  watchEvents(
    onEvent: (event: { action: string; containerName: string }) => void
  ): void {
    const WATCHED_ACTIONS = new Set(["start", "stop", "die", "destroy"]);
    let retryDelay = 1000;
    const MAX_RETRY_DELAY = 30000;

    const connect = () => {
      this.docker.getEvents({}, (err, stream) => {
        if (err || !stream) {
          logger.error("network-discovery", `Failed to get Docker events stream: ${err}`);
          scheduleReconnect();
          return;
        }

        // Reset delay on successful connection
        retryDelay = 1000;

        stream.on("data", (chunk: Buffer) => {
          try {
            const raw = JSON.parse(chunk.toString()) as {
              Type?: string;
              Action?: string;
              Actor?: { Attributes?: Record<string, string> };
            };

            if (raw.Type !== "container") return;
            const action = raw.Action ?? "";
            if (!WATCHED_ACTIONS.has(action)) return;

            const containerName =
              raw.Actor?.Attributes?.name ?? raw.Actor?.Attributes?.["com.docker.compose.service"] ?? "";

            logger.debug("network-discovery", `Docker event: ${action} -> ${containerName}`);
            onEvent({ action, containerName });
          } catch {
            // Ignore malformed event data
          }
        });

        stream.on("error", (streamErr: Error) => {
          logger.error("network-discovery", `Docker events stream error: ${streamErr.message}`);
          scheduleReconnect();
        });

        stream.on("end", () => {
          logger.warn("network-discovery", "Docker events stream ended, reconnecting...");
          scheduleReconnect();
        });
      });
    };

    const scheduleReconnect = () => {
      logger.info("network-discovery", `Reconnecting Docker events in ${retryDelay}ms...`);
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    };

    connect();
  }
}
