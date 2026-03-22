import Docker from "dockerode";
import { logger } from "../lib/logger";
import { list as listProxyHosts } from "./proxy-host";
import type { CloudflaredStatus } from "@/types";

const CONTAINER_NAME = "proxima-cloudflared";
const IMAGE = "cloudflare/cloudflared:latest";

const docker = new Docker();

// Async lock for container lifecycle operations to prevent concurrent start/stop/restart
let containerLock: Promise<void> = Promise.resolve();

async function withContainerLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = containerLock;
  let resolve: () => void;
  containerLock = new Promise(r => { resolve = r; });
  await prev;
  try { return await fn(); } finally { resolve!(); }
}

/** Detect the network and container name of the Proxima container (self). */
async function getProximaContainerInfo(): Promise<{ network: string; hostname: string } | null> {
  try {
    // Try well-known container name first
    const hostname = process.env.HOSTNAME || "";
    const candidates = ["proxima", hostname].filter(Boolean);
    for (const name of candidates) {
      try {
        const info = await docker.getContainer(name).inspect();
        const networks = info.NetworkSettings?.Networks ?? {};
        const netName = Object.keys(networks).find((n) => n !== "bridge" && n !== "host" && n !== "none") ?? Object.keys(networks)[0];
        if (netName) {
          return { network: netName, hostname: info.Config?.Hostname ?? name };
        }
      } catch { /* not found, try next */ }
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

interface TunnelCredentials {
  accountTag: string;
  tunnelId: string;
  tunnelSecret: string;
}

export function parseTunnelToken(token: string): TunnelCredentials {
  // Tunnel token is base64-encoded JSON: {"a":"<account>","t":"<tunnel_id>","s":"<secret>"}
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (!parsed.a || !parsed.t || !parsed.s) {
      throw new Error("missing required fields (a, t, s)");
    }
    return {
      accountTag: parsed.a,
      tunnelId: parsed.t,
      tunnelSecret: parsed.s,
    };
  } catch (err) {
    throw new Error(`Invalid tunnel token: ${err instanceof Error ? err.message : "not valid base64-encoded JSON"}`);
  }
}

// ---------------------------------------------------------------------------
// Tunnel ingress config via Cloudflare API (remotely-managed mode)
// ---------------------------------------------------------------------------

/** Push ingress rules to Cloudflare API so cloudflared picks them up automatically. */
export async function pushTunnelIngress(token: string, apiToken: string): Promise<void> {
  const creds = parseTunnelToken(token);

  const hosts = await listProxyHosts();
  const enabledHosts = hosts.filter((h) => h.enabled);

  // Check if cloudflared is running on host network — if so, localhost works directly
  let cloudflaredOnHost = true;
  try {
    const cfdContainer = docker.getContainer(CONTAINER_NAME);
    const cfdInfo = await cfdContainer.inspect();
    cloudflaredOnHost = cfdInfo.HostConfig?.NetworkMode === "host";
  } catch { /* not running yet, assume host mode */ }

  // Resolve Proxima container name so localhost references can be rewritten
  const proximaInfo = await getProximaContainerInfo();
  const proximaHost = proximaInfo?.hostname ?? "localhost";

  const ingress: Array<{
    hostname?: string;
    service: string;
    originRequest?: { noTLSVerify: boolean };
  }> = [];

  for (const host of enabledHosts) {
    // If cloudflared is on host network, localhost/127.0.0.1 resolves to the host directly
    // Only rewrite to container name when cloudflared is on a Docker bridge network
    const resolvedHost = !cloudflaredOnHost
      && (host.forwardHost === "localhost" || host.forwardHost === "127.0.0.1")
      && proximaInfo?.network && proximaInfo.network !== "host"
      ? proximaHost
      : host.forwardHost;
    const service = `${host.forwardScheme}://${resolvedHost}:${host.forwardPort}`;
    for (const domain of host.domainNames) {
      ingress.push({
        hostname: domain,
        service,
        ...(host.forwardScheme === "https" ? { originRequest: { noTLSVerify: true } } : {}),
      });
    }
  }

  // Catch-all rule (required by cloudflared)
  ingress.push({ service: "http_status:404" });

  // PUT /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations
  const { cfFetch } = await import("./cloudflare");
  const res = await cfFetch(
    `/accounts/${creds.accountTag}/cfd_tunnel/${creds.tunnelId}/configurations`,
    apiToken,
    {
      method: "PUT",
      body: JSON.stringify({ config: { ingress } }),
    },
  );

  if (!res.success) {
    const errMsg = res.errors?.[0]?.message ?? "Unknown error";
    throw new Error(`Failed to push tunnel ingress: ${errMsg}`);
  }

  logger.info("cloudflared", `Pushed ingress config with ${enabledHosts.length} host(s) via API`);
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

/** Check if the running cloudflared container is also connected to Proxima's network. */
export async function checkAndFixNetwork(): Promise<void> {
  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const info = await container.inspect();
    if (!info.State?.Running) return;

    const proximaInfo = await getProximaContainerInfo();
    if (!proximaInfo || proximaInfo.network === "host") return;

    const currentNetworks = Object.keys(info.NetworkSettings?.Networks ?? {});
    if (!currentNetworks.includes(proximaInfo.network)) {
      // Just connect to the missing network — no need to recreate
      try {
        const network = docker.getNetwork(proximaInfo.network);
        await network.connect({ Container: info.Id });
        logger.info("cloudflared", `Connected to missing network: ${proximaInfo.network}`);
      } catch (err) {
        logger.warn("cloudflared", `Failed to connect to ${proximaInfo.network}: ${err}`);
      }
    }
  } catch {
    // ignore — best-effort check
  }
}

export async function getCloudflaredStatus(): Promise<CloudflaredStatus> {
  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const info = await container.inspect();

    if (info.State?.Running === true) {
      const logs = await getContainerLogs(container);
      return { state: "running", containerId: info.Id, logs };
    }

    if (info.State?.Restarting === true) {
      const logs = await getContainerLogs(container);
      return { state: "restarting", containerId: info.Id, logs };
    }

    // Container exited with non-zero exit code → error
    if (info.State?.ExitCode !== undefined && info.State.ExitCode !== 0) {
      const logs = await getContainerLogs(container);
      return {
        state: "error",
        containerId: info.Id,
        error: `Exited with code ${info.State.ExitCode}`,
        logs,
      };
    }

    return { state: "stopped", containerId: info.Id };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
      return { state: "not_found" };
    }
    logger.warn("cloudflared", `Failed to get container status: ${err}`);
    return { state: "not_found" };
  }
}

async function getContainerLogs(container: Docker.Container): Promise<string> {
  try {
    const logBuffer = await container.logs({ stdout: true, stderr: true, tail: 10, follow: false });
    // Docker logs may return a Buffer or string; strip 8-byte header frames
    const raw = typeof logBuffer === "string" ? logBuffer : logBuffer.toString("utf-8");
    // Each Docker log frame has an 8-byte header; strip non-printable prefix per line
    return raw
      .split("\n")
      .map((line) => line.replace(/^[\x00-\x1f]{1,8}/, ""))
      .filter(Boolean)
      .slice(-10)
      .join("\n");
  } catch {
    return "";
  }
}

async function ensureImage(): Promise<void> {
  try {
    await docker.getImage(IMAGE).inspect();
  } catch {
    logger.info("cloudflared", `Pulling image ${IMAGE}...`);
    const stream = await docker.pull(IMAGE);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
    logger.info("cloudflared", "Image pulled successfully");
  }
}

async function removeExisting(): Promise<void> {
  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const info = await container.inspect();
    if (info.State?.Running) {
      await container.stop();
    }
    await container.remove();
    logger.info("cloudflared", "Removed existing container");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
      return;
    }
    throw err;
  }
}

/** Create, start, and connect the cloudflared container, then push ingress config. */
async function createAndStartContainer(token: string): Promise<void> {
  await ensureImage();
  await removeExisting();

  // Start on host network (for outbound Cloudflare connectivity), then also join Proxima's network
  const container = await docker.createContainer({
    name: CONTAINER_NAME,
    Image: IMAGE,
    Cmd: ["tunnel", "--no-autoupdate", "run"],
    Env: [`TUNNEL_TOKEN=${token}`],
    HostConfig: {
      NetworkMode: "host",
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
    },
  });

  await container.start();

  // Also connect to Proxima's Docker network so cloudflared can reach containers by name
  const proximaInfo = await getProximaContainerInfo();
  if (proximaInfo?.network && proximaInfo.network !== "host") {
    try {
      const network = docker.getNetwork(proximaInfo.network);
      await network.connect({ Container: container.id });
      logger.info("cloudflared", `Also connected to network: ${proximaInfo.network}`);
    } catch (err) {
      logger.warn("cloudflared", `Failed to connect to ${proximaInfo.network}: ${err}`);
    }
  }

  logger.info("cloudflared", "Container started (host + proxima network)");

  // Push ingress rules via API
  try {
    const { getCloudflareSettings } = await import("./cloudflare");
    const cfSettings = getCloudflareSettings();
    if (cfSettings.apiToken) {
      await pushTunnelIngress(token, cfSettings.apiToken);
    } else {
      logger.warn("cloudflared", "No Cloudflare API token configured, skipping ingress push");
    }
  } catch (err) {
    logger.warn("cloudflared", `Failed to push initial ingress config: ${err}`);
  }
}

/**
 * Start cloudflared in remotely-managed mode using --token.
 * No config files or volume mounts needed — ingress is managed via Cloudflare API.
 */
export async function startCloudflared(token: string): Promise<void> {
  return withContainerLock(() => createAndStartContainer(token));
}

export async function stopCloudflared(): Promise<void> {
  return withContainerLock(async () => {
    try {
      const container = docker.getContainer(CONTAINER_NAME);
      const info = await container.inspect();
      if (info.State?.Running) {
        await container.stop();
      }
      await container.remove();
      logger.info("cloudflared", "Container stopped and removed");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
        return;
      }
      throw err;
    }
  });
}

export async function restartCloudflared(token: string): Promise<void> {
  return withContainerLock(async () => {
    // Stop and remove existing container before recreating
    try {
      const existing = docker.getContainer(CONTAINER_NAME);
      const info = await existing.inspect();
      if (info.State?.Running) {
        await existing.stop();
      }
      await existing.remove();
      logger.info("cloudflared", "Container stopped and removed");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 404) {
        // ok — container didn't exist
      } else {
        throw err;
      }
    }

    await createAndStartContainer(token);
  });
}

/**
 * Sync ingress rules via Cloudflare API. Called on proxy host CRUD.
 * No container restart needed — cloudflared picks up remote config changes automatically.
 */
export async function syncCloudflaredConfig(): Promise<void> {
  const { getTunnelSettings, getCloudflareSettings } = await import("./cloudflare");
  const settings = getTunnelSettings();
  if (!settings.enabled || !settings.tunnelToken) return;

  const cfSettings = getCloudflareSettings();
  if (!cfSettings.apiToken) {
    logger.warn("cloudflared", "No Cloudflare API token, skipping ingress sync");
    return;
  }

  try {
    await pushTunnelIngress(settings.tunnelToken, cfSettings.apiToken);
  } catch (err) {
    logger.warn("cloudflared", `Ingress sync failed: ${err}`);
  }
}
