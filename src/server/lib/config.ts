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
 * Auto-detect the host path for the container's /data mount
 * by inspecting our own container via the Docker socket.
 */
async function detectHostDataDir(containerDataDir: string): Promise<string> {
  if (cachedHostDataDir) return cachedHostDataDir;
  try {
    const docker = new Docker();
    const hostname = os.hostname();
    const container = docker.getContainer(hostname);
    const info = await container.inspect();
    const mounts = info.Mounts || [];
    const dataMount = mounts.find((m: any) => m.Destination === containerDataDir);
    if (dataMount?.Source) {
      cachedHostDataDir = dataMount.Source;
      logger.info("config", `Auto-detected host data dir: ${cachedHostDataDir}`);
      return cachedHostDataDir;
    }
  } catch {
    // Not running in Docker or can't inspect — use fallback
  }
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
