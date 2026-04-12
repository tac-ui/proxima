import { ChildProcess, fork, spawn } from "node:child_process";
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
// Single in-flight guard so concurrent startOpenClaw() callers (e.g. an
// auto-restart racing with a user-triggered restart) don't end up forking
// two gateways that then fight over port 20242.
let startInFlight: Promise<void> | null = null;

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
  const gitUserName = dbHelpers.getSetting(db, "openclaw:gitUserName")?.value ?? "";
  const gitUserEmail = dbHelpers.getSetting(db, "openclaw:gitUserEmail")?.value ?? "";
  const githubToken = dbHelpers.getSetting(db, "openclaw:githubToken")?.value ?? "";

  return {
    enabled,
    gatewayToken,
    gatewayPort,
    image,
    models,
    sshKeyId: sshKeyId ? parseInt(sshKeyId, 10) : null,
    gitUserName,
    gitUserEmail,
    githubToken,
  };
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
  if (data.gitUserName !== undefined) {
    dbHelpers.setSetting(db, "openclaw:gitUserName", data.gitUserName);
  }
  if (data.gitUserEmail !== undefined) {
    dbHelpers.setSetting(db, "openclaw:gitUserEmail", data.gitUserEmail);
  }
  if (data.githubToken !== undefined) {
    dbHelpers.setSetting(db, "openclaw:githubToken", data.githubToken);
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

/**
 * The canonical OpenClaw agent workspace, shared with Proxima's Harness
 * Files UI. Everything the agent reads/writes (USER.md, CLAUDE.md, SOUL.md,
 * HEARTBEAT.md, etc.) lives here, and the Advanced → Harness Files tab
 * edits the same directory.
 *
 * Placed inside the persistent `pxm-data` volume so it survives container
 * rebuilds. The openclaw gateway is told about this path via
 * `agents.defaults.workspace` in the generated openclaw.json.
 */
export function getWorkspaceDir(): string {
  return path.join(getStateDir(), "workspace");
}

/** Allowed harness file extensions for migration (matches files/route.ts). */
const HARNESS_EXTS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".toml"]);
/** Files that should never be migrated (openclaw state, secrets, config). */
const HARNESS_BLOCKED = new Set([
  "openclaw.json",
  "auth-profiles.json",
  "auth-state.json",
  "update-check.json",
  ".env",
]);

/**
 * Ensure the workspace directory exists. On first run, copy any legacy
 * harness files that lived at the old flat location (`/data/openclaw/*.md`)
 * into the new workspace subdirectory. Idempotent — skips files that
 * already exist at the destination, leaves originals in place.
 */
export function ensureWorkspaceDir(): string {
  const stateDir = getStateDir();
  const workspaceDir = path.join(stateDir, "workspace");
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  // Best-effort migration from the legacy flat layout.
  try {
    const entries = fs.readdirSync(stateDir, { withFileTypes: true });
    let migrated = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name.startsWith(".")) continue;
      if (HARNESS_BLOCKED.has(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!HARNESS_EXTS.has(ext)) continue;
      const src = path.join(stateDir, e.name);
      const dst = path.join(workspaceDir, e.name);
      if (fs.existsSync(dst)) continue;
      try {
        fs.copyFileSync(src, dst);
        migrated++;
      } catch (err) {
        logger.warn("openclaw", `Failed to migrate harness file ${e.name}: ${err}`);
      }
    }
    if (migrated > 0) {
      logger.info("openclaw", `Migrated ${migrated} harness file(s) to ${workspaceDir}`);
    }
  } catch { /* ignore — best effort */ }

  // Seed default skill files with Proxima context
  seedSkillFiles(workspaceDir);

  return workspaceDir;
}

// ---------------------------------------------------------------------------
// Skill file seeding
// ---------------------------------------------------------------------------

interface SkillFile {
  name: string;
  content: () => string;
}

function getSkillFiles(): SkillFile[] {
  const dataDir = process.env.PXM_DATA_DIR || "/data";
  return [
    {
      name: "SKILL-proxima-env.md",
      content: () => `# Proxima Environment

You are running inside **Proxima**, a self-hosted server management platform.

## Data Directory

\`\`\`
${dataDir}/
├── proxima.db              # SQLite (users, repos, stacks, settings, audit)
├── openclaw/               # OpenClaw state
│   ├── workspace/          # Agent workspace (this directory)
│   └── openclaw.json       # Gateway config
├── stacks/                 # Docker Compose stacks
│   └── {name}/
│       ├── compose.yaml
│       └── .env
└── ssl/                    # SSL certificates
\`\`\`

## Notes

- \`proxima.db\` is SQLite — do not write directly
- This workspace is shared with the Harness Files UI
- Docker commands work if the host socket is mounted
`,
    },
    {
      name: "SKILL-proxima-projects.md",
      content: () => `# Proxima Projects

Projects are git repositories cloned and managed by Proxima.

## Structure

- Each project has a configurable local clone path on the host
- Environment files: \`.env\`, \`application-local.properties\`, custom paths
- Environment files are editable in-app per project
- Webhooks support auto-deploy on push

## Git Operations

- Clone, pull, checkout branches via Proxima UI or CLI
- SSH keys are managed in Proxima's SSH Keys section
- Git author name/email configured in OpenClaw Credentials tab
- GitHub PAT (\`GH_TOKEN\`) available for \`gh\` CLI if configured
`,
    },
    {
      name: "SKILL-proxima-docker.md",
      content: () => {
        const dataDir = process.env.PXM_DATA_DIR || "/data";
        return `# Proxima Docker Stacks

Stacks are Docker Compose deployments managed through Proxima.

## Location

\`${dataDir}/stacks/{stack-name}/\`

## Operations

- **create**: New stack with compose.yaml
- **start / stop / restart**: Lifecycle management
- **remove**: Delete stack and its files
- **logs**: View container output
- **compose.yaml**: Editable in-app
- **\`.env\`**: Per-stack environment variables

## Commands

Docker Compose commands run from the stack directory:
\`\`\`bash
cd ${dataDir}/stacks/{name}
docker compose up -d
docker compose logs -f
docker compose down
\`\`\`
`;
      },
    },
    {
      name: "SKILL-proxima-routes.md",
      content: () => `# Proxima Routes & Reverse Proxy

Proxima manages an Nginx reverse proxy for routing traffic.

## Routes

- Map domains/subdomains → upstream services (host:port)
- Support Cloudflare zone selection or manual domain entry
- Root domain toggle (use zone without subdomain)

## SSL

- Auto-managed via Cloudflare DNS integration
- Manual cert upload supported
- Certificates stored in the ssl/ directory

## Analytics

- Per-route traffic analytics
- Status code breakdown (2xx/3xx/4xx/5xx)
- Time-range filtering (24h, 7d, 30d)

## Nginx

- Config auto-generated from routes
- Reload triggered on route changes
- Custom upstream headers supported
`,
    },
    {
      name: "SKILL-proxima-services.md",
      content: () => `# Proxima Services & Capabilities

## User Management
- Roles: admin, manager, viewer
- Admin: full access, user management
- Manager: projects, stacks, routes, OpenClaw config
- Viewer: read-only access

## Monitoring
- Server health checks (CPU, memory, disk)
- Container status monitoring
- Audit logs for all operations

## Notifications
- Telegram and Discord channels
- Webhook notifications on deploy events

## Cloudflare Integration
- DNS zone management
- Auto SSL certificate provisioning
- Analytics data from Cloudflare API

## SSH Keys
- Managed SSH keys for git operations
- Key generation and import
- Per-project key assignment
`,
    },
  ];
}

/** Seed skill reference files in the workspace. Only creates files that don't exist. */
function seedSkillFiles(workspaceDir: string): void {
  const skills = getSkillFiles();
  let seeded = 0;
  for (const skill of skills) {
    const filePath = path.join(workspaceDir, skill.name);
    if (fs.existsSync(filePath)) continue;
    try {
      fs.writeFileSync(filePath, skill.content(), "utf-8");
      seeded++;
    } catch (err) {
      logger.warn("openclaw", `Failed to seed ${skill.name}: ${err}`);
    }
  }
  if (seeded > 0) {
    logger.info("openclaw", `Seeded ${seeded} skill file(s) in workspace`);
  }
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

  // Ensure the agent workspace is inside Proxima's persistent state dir so
  // that files edited via the Harness Files UI and files the agent reads
  // at runtime are the SAME files (not two divergent copies).
  const workspaceDir = ensureWorkspaceDir();

  const existingGateway = (existing.gateway as Record<string, unknown>) ?? {};
  const existingControlUi = (existingGateway.controlUi as Record<string, unknown>) ?? {};
  const existingAgents = (existing.agents as Record<string, unknown>) ?? {};
  const existingDefaults = (existingAgents.defaults as Record<string, unknown>) ?? {};

  const merged = {
    ...existing,
    agents: {
      ...existingAgents,
      defaults: {
        ...existingDefaults,
        // Respect user-configured workspace if present, otherwise pin to
        // Proxima's shared workspace dir.
        workspace: (typeof existingDefaults.workspace === "string" && existingDefaults.workspace.trim().length > 0)
          ? existingDefaults.workspace
          : workspaceDir,
      },
    },
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
        // Proxima always proxies through 127.0.0.1:<port>, so the gateway
        // sees a local client. We disable device-identity checks because
        // WebCrypto SubtleCrypto (required for device pairing) is only
        // available in secure contexts (HTTPS), which Proxima doesn't
        // require for local self-hosted usage. The gateway itself only
        // listens on 127.0.0.1 and is reached via the authenticated
        // Proxima proxy, so the trust boundary is Proxima's own session.
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true,
      },
    },
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), "utf-8");
    logger.info("openclaw", `Updated gateway config at ${configPath} (workspace=${workspaceDir})`);
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
 * SIGKILL any process currently listening on the given TCP port. Used before
 * spawning a new gateway to guarantee the port is free regardless of how we
 * lost track of the previous process (e.g. restart race where Proxima's
 * `gatewayProcess` reference was cleared but the actual child was still
 * listening, or an openclaw-internal in-process restart left a zombie).
 * Best-effort: always resolves.
 */
async function freePort(port: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      // `lsof -ti :<port> -s TCP:LISTEN` prints one PID per line. The -s
      // filter narrows to actual listeners (excludes transient client sockets).
      const lsof = spawn("sh", ["-c", `lsof -ti :${port} -s TCP:LISTEN 2>/dev/null`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      lsof.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
      lsof.on("close", () => {
        const pids = out
          .trim()
          .split("\n")
          .map(s => parseInt(s, 10))
          .filter(n => Number.isFinite(n) && n > 0 && n !== process.pid);
        if (pids.length === 0) { resolve(); return; }
        logger.info("openclaw", `Freeing port ${port}: killing stale PIDs ${pids.join(", ")}`);
        for (const pid of pids) {
          try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
        }
        // Give the kernel a moment to reclaim the socket before we bind it.
        setTimeout(resolve, 500);
      });
      lsof.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

export async function startOpenClaw(): Promise<void> {
  // Reuse the in-flight promise so concurrent callers don't spawn duplicates.
  if (startInFlight) return startInFlight;

  if (gatewayProcess && gatewayProcess.exitCode === null) {
    logger.info("openclaw", "Gateway already running");
    return;
  }

  startInFlight = (async () => {
    try {
      await startOpenClawInternal();
    } finally {
      startInFlight = null;
    }
  })();
  return startInFlight;
}

async function startOpenClawInternal(): Promise<void> {
  if (gatewayProcess && gatewayProcess.exitCode === null) {
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
    // Proxima is the single authority over the gateway lifecycle. Bypass
    // the gateway-lock.ts single-instance guard so we never get stuck on
    // "gateway already running (pid ...); lock timeout after 5000ms" after
    // a restart where the previous process is still releasing its lock.
    OPENCLAW_ALLOW_MULTI_GATEWAY: "1",
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
  if (models.moonshotApiKey) env.MOONSHOT_API_KEY = models.moonshotApiKey;
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

  // Git commit identity. Using GIT_AUTHOR_* / GIT_COMMITTER_* env vars is
  // more robust than writing a global ~/.gitconfig because it works inside
  // any CWD the agent picks (cloned repos may have their own user config)
  // and doesn't require a mutable $HOME. Both pairs are required: author
  // covers new commits, committer covers amends/rebases.
  if (settings.gitUserName) {
    env.GIT_AUTHOR_NAME = settings.gitUserName;
    env.GIT_COMMITTER_NAME = settings.gitUserName;
  }
  if (settings.gitUserEmail) {
    env.GIT_AUTHOR_EMAIL = settings.gitUserEmail;
    env.GIT_COMMITTER_EMAIL = settings.gitUserEmail;
  }

  // GitHub token for PR creation. GH_TOKEN is what the `gh` CLI reads;
  // GITHUB_TOKEN is the REST-API convention used by curl scripts and
  // GitHub Actions-style tooling. Exposing both covers every way the
  // agent might try to authenticate.
  if (settings.githubToken) {
    env.GH_TOKEN = settings.githubToken;
    env.GITHUB_TOKEN = settings.githubToken;
  }

  // Reset state
  lastLogs = [];
  lastError = null;

  const binPath = getOpenClawBin();
  logger.info("openclaw", `Starting gateway on port ${port} (bin: ${binPath})`);

  // Write gateway config so the binary doesn't bail on "Missing config"
  writeGatewayConfig(stateDir, { port, bind: "lan", mode: "local" });

  // Guarantee the port is free. If we lost track of a previous gateway
  // (e.g. restart race where stopOpenClaw hit the early-return path),
  // the kernel still holds the port and the fork would fail with
  // EADDRINUSE. lsof + SIGKILL is the cleanest cross-scenario guard.
  await freePort(port);

  // --verbose enables openclaw's logVerbose() output (Discord inbound/preflight
  // traces, channel filter decisions, agent run details). Without this flag,
  // `discord: inbound` and similar diagnostic lines are silently dropped by
  // shouldLogVerbose(), making it impossible to diagnose message-flow issues
  // like "bot online but not responding".
  gatewayProcess = fork(binPath, ["gateway", "--verbose", "--bind", "lan", "--port", String(port)], {
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
