import Docker from "dockerode";
import { logger } from "../lib/logger";
import { list as listProxyHosts } from "./proxy-host";
import type { CloudflaredStatus } from "@/types";

const CONTAINER_NAME = "proxima-cloudflared";
const IMAGE = "cloudflare/cloudflared:latest";

const docker = new Docker();

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
  const decoded = Buffer.from(token, "base64").toString("utf-8");
  const parsed = JSON.parse(decoded);
  if (!parsed.a || !parsed.t || !parsed.s) {
    throw new Error("Invalid tunnel token: missing required fields");
  }
  return {
    accountTag: parsed.a,
    tunnelId: parsed.t,
    tunnelSecret: parsed.s,
  };
}

// ---------------------------------------------------------------------------
// Tunnel ingress config via Cloudflare API (remotely-managed mode)
// ---------------------------------------------------------------------------

/** Push ingress rules to Cloudflare API so cloudflared picks them up automatically. */
export async function pushTunnelIngress(token: string, apiToken: string): Promise<void> {
  const creds = parseTunnelToken(token);

  const hosts = await listProxyHosts();
  const enabledHosts = hosts.filter((h) => h.enabled);

  // Resolve Proxima container name so localhost references can be rewritten
  const proximaInfo = await getProximaContainerInfo();
  const proximaHost = proximaInfo?.hostname ?? "localhost";

  const ingress: Array<{
    hostname?: string;
    service: string;
    originRequest?: { noTLSVerify: boolean };
  }> = [];

  for (const host of enabledHosts) {
    // If forwardHost is localhost/127.0.0.1 and we're on a Docker network, rewrite to Proxima container name
    const resolvedHost = (host.forwardHost === "localhost" || host.forwardHost === "127.0.0.1")
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

/**
 * Start cloudflared in remotely-managed mode using --token.
 * No config files or volume mounts needed — ingress is managed via Cloudflare API.
 */
export async function startCloudflared(token: string): Promise<void> {
  await ensureImage();
  await removeExisting();

  // Try to join the same Docker network as the Proxima container
  const proximaInfo = await getProximaContainerInfo();
  const networkMode = proximaInfo?.network ?? "host";

  const container = await docker.createContainer({
    name: CONTAINER_NAME,
    Image: IMAGE,
    Cmd: ["tunnel", "--no-autoupdate", "--config", "/dev/null", "run", "--token", token],
    HostConfig: {
      NetworkMode: networkMode,
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
    },
  });

  await container.start();
  logger.info("cloudflared", `Container started (network: ${networkMode})`);

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

export async function stopCloudflared(): Promise<void> {
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
}

export async function restartCloudflared(token: string): Promise<void> {
  await stopCloudflared();
  await startCloudflared(token);
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
