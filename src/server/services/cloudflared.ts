import fs from "node:fs";
import path from "node:path";
import Docker from "dockerode";
import { logger } from "../lib/logger";
import { getConfig } from "../lib/config";
import { list as listProxyHosts } from "./proxy-host";
import type { CloudflaredStatus } from "@/types";

const CONTAINER_NAME = "proxima-cloudflared";
const IMAGE = "cloudflare/cloudflared:latest";

const docker = new Docker();

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
// Config file generation
// ---------------------------------------------------------------------------

function getCloudflaredDir(): string {
  const config = getConfig();
  const dir = path.join(config.dataDir, "cloudflared");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCredentialsFile(creds: TunnelCredentials): string {
  const dir = getCloudflaredDir();
  const filePath = path.join(dir, "credentials.json");
  const content = JSON.stringify({
    AccountTag: creds.accountTag,
    TunnelSecret: creds.tunnelSecret,
    TunnelID: creds.tunnelId,
  });
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/** Escape a YAML string value — wrap in quotes if it contains special characters. */
function yamlEscape(value: string): string {
  if (/[:{}\[\],&*?|>!%#@`"'\n\\]/.test(value) || value.trim() !== value) {
    return JSON.stringify(value);
  }
  return value;
}

function writeConfigFile(tunnelId: string, ingress: { hostname?: string; service: string; originRequest?: { noTLSVerify: boolean } }[], credentialsPath = "/etc/cloudflared/credentials.json"): string {
  const dir = getCloudflaredDir();
  const filePath = path.join(dir, "config.yml");

  const lines: string[] = [
    `tunnel: ${yamlEscape(tunnelId)}`,
    `credentials-file: ${credentialsPath}`,
    ``,
    `ingress:`,
  ];

  for (const rule of ingress) {
    if (rule.hostname) {
      lines.push(`  - hostname: ${yamlEscape(rule.hostname)}`);
      lines.push(`    service: ${yamlEscape(rule.service)}`);
      if (rule.originRequest?.noTLSVerify) {
        lines.push(`    originRequest:`);
        lines.push(`      noTLSVerify: true`);
      }
    } else {
      lines.push(`  - service: ${yamlEscape(rule.service)}`);
    }
  }

  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  return filePath;
}

/** Build ingress rules from proxy hosts and write config files. */
export async function generateCloudflaredConfig(token: string, credentialsPath = "/etc/cloudflared/credentials.json"): Promise<{ tunnelId: string }> {
  const creds = parseTunnelToken(token);
  writeCredentialsFile(creds);

  const hosts = await listProxyHosts();
  const enabledHosts = hosts.filter((h) => h.enabled);

  const ingress: { hostname?: string; service: string; originRequest?: { noTLSVerify: boolean } }[] = [];

  for (const host of enabledHosts) {
    const service = `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`;
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

  writeConfigFile(creds.tunnelId, ingress, credentialsPath);
  logger.info("cloudflared", `Generated config with ${enabledHosts.length} host(s)`);

  return { tunnelId: creds.tunnelId };
}

// ---------------------------------------------------------------------------
// Container lifecycle
// ---------------------------------------------------------------------------

export async function getCloudflaredStatus(): Promise<CloudflaredStatus> {
  try {
    const container = docker.getContainer(CONTAINER_NAME);
    const info = await container.inspect();

    if (info.State?.Running === true) {
      return { state: "running", containerId: info.Id };
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

export async function startCloudflared(token: string): Promise<void> {
  const { getHostDataDir, getDataVolumeName } = await import("../lib/config");

  // Try to find the Docker volume name for reliable volume-based mounting
  const volumeName = await getDataVolumeName();
  const useVolume = !!volumeName;

  // Set paths based on mount strategy
  const cfgDir = useVolume ? "/pxm-data/cloudflared" : "/etc/cloudflared";
  const credentialsPath = `${cfgDir}/credentials.json`;
  const configFilePath = `${cfgDir}/config.yml`;

  // Generate config files with the correct credentials path
  await generateCloudflaredConfig(token, credentialsPath);

  // Verify config files were generated before starting container
  const localDir = getCloudflaredDir();
  const localConfigPath = path.join(localDir, "config.yml");
  const localCredsPath = path.join(localDir, "credentials.json");
  if (!fs.existsSync(localConfigPath) || !fs.existsSync(localCredsPath)) {
    throw new Error(`Cloudflared config files missing in ${localDir}. Cannot start container.`);
  }

  await ensureImage();
  await removeExisting();

  let binds: string[];

  if (useVolume) {
    // Volume mount — most reliable, works on all Docker setups
    binds = [`${volumeName}:/pxm-data:ro`];
    logger.info("cloudflared", `Volume mount: ${volumeName} -> /pxm-data (read-only)`);
  } else {
    // Fallback: host path bind mount
    const hostCloudflaredDir = path.resolve(path.join(getHostDataDir(), "cloudflared"));
    if (!path.isAbsolute(hostCloudflaredDir)) {
      throw new Error(`Host cloudflared dir is not absolute: ${hostCloudflaredDir}. Set PXM_HOST_DATA_DIR to fix.`);
    }
    binds = [`${hostCloudflaredDir}:/etc/cloudflared:ro`];
    logger.info("cloudflared", `Bind mount: ${hostCloudflaredDir} -> /etc/cloudflared`);
  }

  const container = await docker.createContainer({
    name: CONTAINER_NAME,
    Image: IMAGE,
    Cmd: ["tunnel", "--config", configFilePath, "--no-autoupdate", "run"],
    HostConfig: {
      NetworkMode: "host",
      RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
      Binds: binds,
    },
  });

  await container.start();
  logger.info("cloudflared", `Container started (${useVolume ? "volume" : "bind"} mount)`);
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

/** Regenerate config and restart container if running. Called on proxy host CRUD. */
export async function syncCloudflaredConfig(): Promise<void> {
  // Lazy import to avoid circular dependency
  const { getTunnelSettings } = await import("./cloudflare");
  const settings = getTunnelSettings();
  if (!settings.enabled || !settings.tunnelToken) return;

  try {
    await generateCloudflaredConfig(settings.tunnelToken);

    const status = await getCloudflaredStatus();
    if (status.state === "running") {
      await restartCloudflared(settings.tunnelToken);
    }
  } catch (err) {
    logger.warn("cloudflared", `Config sync failed: ${err}`);
  }
}
