import { ChildProcess, fork } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger";
import { getDb, dbHelpers, schema } from "../db";
import { eq } from "drizzle-orm";
import type { OpenClawSettings, OpenClawModels, OpenClawStatus } from "@/types";

const DEFAULT_PORT = 20242;

const MAX_RESTARTS = 5;

let gatewayProcess: ChildProcess | null = null;
let lastLogs: string[] = [];
let lastError: string | null = null;
let restartCount = 0;

// Resolve the openclaw bin path from node_modules
function getOpenClawBin(): string {
  const candidates = [
    path.resolve(process.cwd(), "node_modules", "openclaw", "openclaw.mjs"),
    path.resolve(process.cwd(), "node_modules", ".bin", "openclaw"),
    "/app/node_modules/openclaw/openclaw.mjs",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return "openclaw";
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export function getOpenClawSettings(): OpenClawSettings {
  const db = getDb();
  const enabled = dbHelpers.getSetting(db, "openclaw:enabled")?.value === "true";
  const gatewayToken = dbHelpers.getSetting(db, "openclaw:gatewayToken")?.value ?? "";
  const savedPort = parseInt(dbHelpers.getSetting(db, "openclaw:gatewayPort")?.value ?? String(DEFAULT_PORT), 10);
  // Auto-migrate legacy default port (18789 → 20242)
  const gatewayPort = savedPort === 18789 ? DEFAULT_PORT : savedPort;
  const image = dbHelpers.getSetting(db, "openclaw:image")?.value ?? "";
  let models: OpenClawModels = {};
  try {
    const raw = dbHelpers.getSetting(db, "openclaw:models")?.value;
    if (raw) models = JSON.parse(raw);
  } catch { /* ignore */ }

  const sshKeyId = dbHelpers.getSetting(db, "openclaw:sshKeyId")?.value;

  return { enabled, gatewayToken, gatewayPort, image, models, sshKeyId: sshKeyId ? parseInt(sshKeyId, 10) : null };
}

export function saveOpenClawSettings(data: Partial<OpenClawSettings>): OpenClawSettings {
  const db = getDb();
  const current = getOpenClawSettings();

  if (data.enabled !== undefined) {
    dbHelpers.setSetting(db, "openclaw:enabled", String(data.enabled));
  }
  if (data.gatewayToken !== undefined) {
    dbHelpers.setSetting(db, "openclaw:gatewayToken", data.gatewayToken);
  }
  if (data.gatewayPort !== undefined) {
    dbHelpers.setSetting(db, "openclaw:gatewayPort", String(data.gatewayPort));
  }
  if (data.image !== undefined) {
    dbHelpers.setSetting(db, "openclaw:image", data.image);
  }
  if (data.models !== undefined) {
    const merged: Record<string, string> = { ...current.models as Record<string, string> };
    for (const [key, val] of Object.entries(data.models)) {
      if (val === "" || val === undefined) {
        delete merged[key];
      } else if (typeof val === "string") {
        merged[key] = val;
      }
    }
    dbHelpers.setSetting(db, "openclaw:models", JSON.stringify(merged));
  }
  if (data.sshKeyId !== undefined) {
    dbHelpers.setSetting(db, "openclaw:sshKeyId", String(data.sshKeyId ?? ""));
  }

  return getOpenClawSettings();
}

/** Generate a gateway token if none exists. */
export function ensureGatewayToken(): string {
  const db = getDb();
  const existing = dbHelpers.getSetting(db, "openclaw:gatewayToken")?.value;
  if (existing) return existing;

  const token = crypto.randomBytes(32).toString("hex");
  dbHelpers.setSetting(db, "openclaw:gatewayToken", token);
  return token;
}

// ---------------------------------------------------------------------------
// State directory management
// ---------------------------------------------------------------------------

function getStateDir(): string {
  const dataDir = process.env.PXM_DATA_DIR || "/data";
  const stateDir = path.join(dataDir, "openclaw");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  return stateDir;
}

/** Write/merge gateway config to openclaw.json. Preserves user-edited fields. */
function writeGatewayConfig(stateDir: string, opts: { port: number; bind?: string; mode?: string }): void {
  const configPath = path.join(stateDir, "openclaw.json");
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch { /* malformed, start fresh */ }
  }

  const existingGateway = (existing.gateway as Record<string, unknown>) ?? {};
  const existingControlUi = (existingGateway.controlUi as Record<string, unknown>) ?? {};
  const merged = {
    ...existing,
    gateway: {
      ...existingGateway,
      mode: opts.mode ?? existingGateway.mode ?? "local",
      port: opts.port,
      bind: opts.bind ?? existingGateway.bind ?? "lan",
      controlUi: {
        ...existingControlUi,
        // Accept all origins — Proxima proxies through /api/openclaw/ws
        // so the client origin varies with the user's Proxima URL.
        allowedOrigins: ["*"],
      },
    },
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
    logger.info("openclaw", `Updated gateway config at ${configPath}`);
  } catch (err) {
    logger.warn("openclaw", `Failed to write config file: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Auth profile management (custom token providers)
// Writes to ~/.openclaw/agents/main/agent/auth-profiles.json
// ---------------------------------------------------------------------------

interface AuthProfileStore {
  version: number;
  profiles: Record<string, AuthProfileCredential>;
}

interface AuthProfileCredential {
  type: "token";
  provider: string;
  token?: string;
  expires?: number;
  displayName?: string;
}

function getAuthProfilesPath(): string {
  const stateDir = getStateDir();
  const agentDir = path.join(stateDir, "agents", "main", "agent");
  if (!fs.existsSync(agentDir)) fs.mkdirSync(agentDir, { recursive: true });
  return path.join(agentDir, "auth-profiles.json");
}

function normalizeProviderId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function loadAuthProfiles(): AuthProfileStore {
  const filePath = getAuthProfilesPath();
  if (!fs.existsSync(filePath)) return { version: 1, profiles: {} };
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.profiles) return parsed as AuthProfileStore;
  } catch (err) {
    logger.warn("openclaw", `Failed to parse auth-profiles.json: ${err}`);
  }
  return { version: 1, profiles: {} };
}

function saveAuthProfiles(store: AuthProfileStore): void {
  fs.writeFileSync(getAuthProfilesPath(), JSON.stringify(store, null, 2), "utf-8");
}

export function listAuthProfiles(): { profileId: string; provider: string; hasToken: boolean; expires?: number; displayName?: string }[] {
  const store = loadAuthProfiles();
  return Object.entries(store.profiles).map(([profileId, cred]) => ({
    profileId,
    provider: cred.provider,
    hasToken: !!cred.token,
    expires: cred.expires,
    displayName: cred.displayName,
  }));
}

export function upsertAuthProfile(params: {
  provider: string;
  profileId?: string;
  token: string;
  expiresInDays?: number;
  displayName?: string;
}): { profileId: string; provider: string } {
  const provider = normalizeProviderId(params.provider);
  if (!provider) throw new Error("Invalid provider id");
  if (!params.token?.trim()) throw new Error("Token is required");

  const profileId = params.profileId?.trim() || `${provider}:manual`;
  const store = loadAuthProfiles();

  const credential: AuthProfileCredential = {
    type: "token",
    provider,
    token: params.token.trim(),
  };
  if (params.expiresInDays && params.expiresInDays > 0) {
    credential.expires = Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000;
  }
  if (params.displayName?.trim()) {
    credential.displayName = params.displayName.trim();
  }

  store.profiles[profileId] = credential;
  saveAuthProfiles(store);
  logger.info("openclaw", `Auth profile saved: ${profileId} (${provider})`);

  return { profileId, provider };
}

export function removeAuthProfile(profileId: string): void {
  const store = loadAuthProfiles();
  if (store.profiles[profileId]) {
    delete store.profiles[profileId];
    saveAuthProfiles(store);
    logger.info("openclaw", `Auth profile removed: ${profileId}`);
  }
}

// ---------------------------------------------------------------------------
// Process status
// ---------------------------------------------------------------------------

export function getOpenClawStatus(): OpenClawStatus {
  const settings = getOpenClawSettings();

  if (!gatewayProcess || gatewayProcess.exitCode !== null) {
    if (lastError) {
      return {
        state: "error",
        error: lastError,
        logs: lastLogs.join("\n"),
      };
    }
    return { state: "not_found" };
  }

  return {
    state: "running",
    containerId: String(gatewayProcess.pid),
    logs: lastLogs.join("\n"),
    gatewayUrl: `http://localhost:${settings.gatewayPort}`,
  };
}

function appendLog(line: string) {
  lastLogs.push(line);
  if (lastLogs.length > 30) lastLogs = lastLogs.slice(-30);
}

// ---------------------------------------------------------------------------
// Process lifecycle
// ---------------------------------------------------------------------------

/**
 * Invoke `openclaw gateway stop` to release a stale lock held by a previous
 * gateway instance that Proxima has lost track of. Best-effort: always
 * resolves, even on failure or timeout.
 */
function stopStaleGateway(binPath: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve) => {
    try {
      const proc = fork(binPath, ["gateway", "stop"], {
        env,
        stdio: "ignore",
        detached: false,
      });
      const timer = setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* ignore */ }
        resolve();
      }, 5000);
      proc.on("exit", () => { clearTimeout(timer); resolve(); });
      proc.on("error", () => { clearTimeout(timer); resolve(); });
    } catch {
      resolve();
    }
  });
}

export async function startOpenClaw(): Promise<void> {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    logger.info("openclaw", "Gateway already running");
    return;
  }

  const settings = getOpenClawSettings();
  if (!settings.enabled) {
    throw new Error("OpenClaw is not enabled");
  }

  const token = settings.gatewayToken || ensureGatewayToken();
  const port = settings.gatewayPort || DEFAULT_PORT;
  const stateDir = getStateDir();

  // Build environment
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_PORT: String(port),
    OPENCLAW_GATEWAY_BIND: "lan",
    OPENCLAW_STATE_DIR: stateDir,
    NODE_ENV: "production",
  };

  // Add model API keys
  const { models } = settings;
  if (models.openaiApiKey) env.OPENAI_API_KEY = models.openaiApiKey;
  if (models.anthropicApiKey) env.ANTHROPIC_API_KEY = models.anthropicApiKey;
  if (models.geminiApiKey) env.GEMINI_API_KEY = models.geminiApiKey;
  if (models.openrouterApiKey) env.OPENROUTER_API_KEY = models.openrouterApiKey;
  if (models.deepseekApiKey) env.DEEPSEEK_API_KEY = models.deepseekApiKey;
  if (models.xaiApiKey) env.XAI_API_KEY = models.xaiApiKey;
  if (models.zaiApiKey) env.ZAI_API_KEY = models.zaiApiKey;
  if (models.groqApiKey) env.GROQ_API_KEY = models.groqApiKey;
  if (models.mistralApiKey) env.MISTRAL_API_KEY = models.mistralApiKey;
  if (models.fireworksApiKey) env.FIREWORKS_API_KEY = models.fireworksApiKey;
  if (models.perplexityApiKey) env.PERPLEXITY_API_KEY = models.perplexityApiKey;
  if (models.azureOpenaiApiKey) env.AZURE_OPENAI_API_KEY = models.azureOpenaiApiKey;
  if (models.azureOpenaiEndpoint) env.AZURE_OPENAI_ENDPOINT = models.azureOpenaiEndpoint;
  if (models.cloudflareAiGwApiKey) env.CLOUDFLARE_AI_GATEWAY_API_KEY = models.cloudflareAiGwApiKey;
  if (models.ollamaBaseUrl) env.OLLAMA_HOST = models.ollamaBaseUrl;

  // SSH key for git operations
  if (settings.sshKeyId) {
    const db = getDb();
    const key = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, settings.sshKeyId)).get();
    if (key?.keyPath) {
      env.GIT_SSH_COMMAND = `ssh -i "${key.keyPath}" -o StrictHostKeyChecking=accept-new`;
    }
  }

  // Reset state
  lastLogs = [];
  lastError = null;

  const binPath = getOpenClawBin();
  logger.info("openclaw", `Starting gateway on port ${port} (bin: ${binPath})`);

  // Write gateway config so the binary doesn't bail on "Missing config"
  writeGatewayConfig(stateDir, { port, bind: "lan", mode: "local" });

  // Clean up any stale gateway instance that may be holding the lock file
  // (e.g. after a Proxima container restart where the prior gateway
  // detached or was left behind). Best-effort; ignore errors.
  await stopStaleGateway(binPath, env);

  gatewayProcess = fork(binPath, ["gateway", "--bind", "lan", "--port", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: false,
  });

  gatewayProcess.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      appendLog(line);
      logger.info("openclaw", line);
    }
  });

  gatewayProcess.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      appendLog(line);
      logger.warn("openclaw", line);
    }
  });

  gatewayProcess.on("exit", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    logger.info("openclaw", `Gateway process exited (${reason})`);
    if (code !== 0 && code !== null) {
      lastError = `Process exited with ${reason}`;
    }
    gatewayProcess = null;

    // Auto-restart if it crashed (not explicitly stopped), with max retries
    if (code !== 0 && code !== null && !signal) {
      restartCount++;
      const settings = getOpenClawSettings();
      if (settings.enabled && restartCount <= MAX_RESTARTS) {
        const delay = Math.min(3000 * Math.pow(1.5, restartCount - 1), 30000);
        logger.info("openclaw", `Auto-restarting gateway in ${Math.round(delay / 1000)}s (attempt ${restartCount}/${MAX_RESTARTS})...`);
        setTimeout(() => {
          startOpenClaw().catch((err) => {
            logger.error("openclaw", `Auto-restart failed: ${err}`);
          });
        }, delay);
      } else if (restartCount > MAX_RESTARTS) {
        lastError = `Gateway crashed ${MAX_RESTARTS} times. Auto-restart disabled. Check configuration and restart manually.`;
        logger.error("openclaw", lastError);
      }
    }
  });

  gatewayProcess.on("error", (err) => {
    lastError = err.message;
    logger.error("openclaw", `Gateway process error: ${err.message}`);
    gatewayProcess = null;
  });

  // Wait briefly for process to stabilize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (gatewayProcess && gatewayProcess.exitCode === null) {
    restartCount = 0;
    logger.info("openclaw", `Gateway started (pid: ${gatewayProcess.pid})`);
  } else {
    throw new Error(lastError || "Gateway process failed to start");
  }
}

export async function stopOpenClaw(): Promise<void> {
  if (!gatewayProcess || gatewayProcess.exitCode !== null) {
    gatewayProcess = null;
    logger.info("openclaw", "Gateway not running");
    return;
  }

  const pid = gatewayProcess.pid;
  logger.info("openclaw", `Stopping gateway (pid: ${pid})`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill after 5s
      if (gatewayProcess && gatewayProcess.exitCode === null) {
        gatewayProcess.kill("SIGKILL");
      }
      gatewayProcess = null;
      resolve();
    }, 5000);

    gatewayProcess!.on("exit", () => {
      clearTimeout(timeout);
      gatewayProcess = null;
      lastError = null;
      resolve();
    });

    gatewayProcess!.kill("SIGTERM");
  });
}

export async function restartOpenClaw(): Promise<void> {
  await stopOpenClaw();
  await startOpenClaw();
}

/** Called on server startup — auto-start if enabled. */
export async function autoStartOpenClaw(): Promise<void> {
  try {
    const settings = getOpenClawSettings();
    if (settings.enabled) {
      logger.info("openclaw", "Auto-starting gateway (enabled in settings)");
      await startOpenClaw();
    }
  } catch (err) {
    logger.error("openclaw", `Auto-start failed: ${err}`);
  }
}

/** Graceful shutdown — called on server exit. */
export async function shutdownOpenClaw(): Promise<void> {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
    logger.info("openclaw", "Shutting down gateway...");
    await stopOpenClaw();
  }
}
