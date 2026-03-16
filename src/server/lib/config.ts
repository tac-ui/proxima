import fs from "node:fs";
import Docker from "dockerode";
import os from "os";
import { logger } from "./logger";

export interface Config {
  port: number;
  hostname: string;
  dataDir: string;
  hostDataDir: string;
  stacksDir: string;
  jwtSecret?: string;
  githubClientId?: string;
  githubClientSecret?: string;
}

let cachedHostDataDir: string | null = null;

/**
 * Try to get our own container ID from /proc/self/cgroup or /proc/1/cpuset.
 */
function getOwnContainerId(): string | null {
  try {
    // Try /proc/self/cgroup first (works on cgroup v1 and some v2)
    const cgroup = fs.readFileSync("/proc/self/cgroup", "utf-8");
    for (const line of cgroup.split("\n")) {
      // e.g. "0::/docker/<container_id>" or "12:memory:/docker/<container_id>"
      const match = line.match(/[/]docker[/]([a-f0-9]{12,64})/);
      if (match) return match[1];
    }
  } catch { /* not available */ }
  try {
    // Try /proc/1/cpuset
    const cpuset = fs.readFileSync("/proc/1/cpuset", "utf-8").trim();
    const match = cpuset.match(/[/]docker[/]([a-f0-9]{12,64})/);
    if (match) return match[1];
  } catch { /* not available */ }
  try {
    // Try /proc/self/mountinfo for overlay fs (cgroup v2 / Docker Desktop)
    const mountinfo = fs.readFileSync("/proc/self/mountinfo", "utf-8");
    for (const line of mountinfo.split("\n")) {
      const match = line.match(/[/]docker[/]containers[/]([a-f0-9]{12,64})/);
      if (match) return match[1];
    }
  } catch { /* not available */ }
  return null;
}

/**
 * Extract host data dir from a container inspect result.
 */
function extractHostDataDir(info: any, containerDataDir: string): string | null {
  // Strategy 1: Check Mounts array
  const mounts = info.Mounts || [];
  const dataMount = mounts.find((m: any) => m.Destination === containerDataDir);
  if (dataMount?.Source) return dataMount.Source;

  // Strategy 2: Check HostConfig.Binds (raw bind strings like "/host/path:/container/path:rw")
  const binds: string[] = info.HostConfig?.Binds || [];
  for (const bind of binds) {
    const parts = bind.split(":");
    if (parts.length >= 2 && parts[1] === containerDataDir) return parts[0];
  }

  return null;
}

/**
 * Auto-detect the host path for the container's /data mount
 * by inspecting our own container via the Docker socket.
 */
async function detectHostDataDir(containerDataDir: string): Promise<string> {
  if (cachedHostDataDir) return cachedHostDataDir;

  const docker = new Docker();

  // Try multiple identification methods
  const candidates: string[] = [];

  // 1. os.hostname() — default container ID or custom hostname
  candidates.push(os.hostname());

  // 2. Container ID from /proc
  const procId = getOwnContainerId();
  if (procId && !candidates.includes(procId)) candidates.push(procId);

  for (const candidate of candidates) {
    try {
      const container = docker.getContainer(candidate);
      const info = await container.inspect();
      const hostDir = extractHostDataDir(info, containerDataDir);
      if (hostDir) {
        cachedHostDataDir = hostDir;
        logger.info("config", `Auto-detected host data dir: ${cachedHostDataDir} (via ${candidate === procId ? "/proc" : "hostname"})`);
        return cachedHostDataDir;
      }
      logger.warn("config", `Container ${candidate} found but no mount for ${containerDataDir}`);
    } catch {
      logger.debug("config", `Could not inspect container ${candidate}`);
    }
  }

  logger.warn("config", `Could not auto-detect host data dir for ${containerDataDir}, using as-is`);
  return containerDataDir;
}

export function getConfig(): Config {
  const dataDir = process.env.PXM_DATA_DIR || "./data";
  return {
    port: parseInt(process.env.PXM_PORT || "20222"),
    hostname: process.env.PXM_HOSTNAME || "0.0.0.0",
    dataDir,
    hostDataDir: process.env.PXM_HOST_DATA_DIR || dataDir,
    stacksDir: process.env.PXM_STACKS_DIR || "./data/stacks",
    githubClientId: process.env.GITHUB_CLIENT_ID,
    githubClientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

/** Initialize hostDataDir by auto-detecting from Docker mount info. */
export async function initHostDataDir(): Promise<void> {
  if (process.env.PXM_HOST_DATA_DIR) return; // explicit override
  const dataDir = process.env.PXM_DATA_DIR || "./data";
  const detected = await detectHostDataDir(dataDir);
  if (detected !== dataDir) {
    cachedHostDataDir = detected;
  }
}

/** Get hostDataDir (sync, uses cached value after init). */
export function getHostDataDir(): string {
  const dataDir = process.env.PXM_DATA_DIR || "./data";
  return process.env.PXM_HOST_DATA_DIR || cachedHostDataDir || dataDir;
}
