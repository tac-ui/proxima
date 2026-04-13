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

  // Inject Proxima directive block into AGENTS.md
  injectAgentsDirective(workspaceDir);

  return workspaceDir;
}

// ---------------------------------------------------------------------------
// Skill file seeding
// ---------------------------------------------------------------------------

interface SkillFile {
  name: string;
  content: () => string;
}

// ---------------------------------------------------------------------------
// AGENTS.md directive injection
// ---------------------------------------------------------------------------

const AGENTS_DIRECTIVE_START = "<!-- proxima:agents-directive:start -->";
const AGENTS_DIRECTIVE_END = "<!-- proxima:agents-directive:end -->";

function getAgentsDirectiveBlock(): string {
  const version = getSkillVersion();
  return `${AGENTS_DIRECTIVE_START}
# Proxima Integration (v${version})

You are running inside Proxima. Read the following skill files to understand the platform and its API:

- **SKILL-proxima-guide.md** — Overview, data structure, available skills index
- **SKILL-proxima-stacks.md** — Docker stack management API
- **SKILL-proxima-routes.md** — Reverse proxy & domain management API
- **SKILL-proxima-projects.md** — Git repository, script, webhook management API
- **SKILL-proxima-services.md** — Users, monitoring, notifications, SSH keys API

Use \`PROXIMA_URL\` and \`PROXIMA_TOKEN\` environment variables for API access.
Authenticate with the \`X-Service-Token: $PROXIMA_TOKEN\` header (never expires).
Always prefer the Proxima API over direct file or database manipulation.
${AGENTS_DIRECTIVE_END}`;
}

function injectAgentsDirective(workspaceDir: string): void {
  const filePath = path.join(workspaceDir, "AGENTS.md");
  const block = getAgentsDirectiveBlock();

  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf-8");

    // Check if block already exists — replace it
    const startIdx = content.indexOf(AGENTS_DIRECTIVE_START);
    const endIdx = content.indexOf(AGENTS_DIRECTIVE_END);
    if (startIdx !== -1 && endIdx !== -1) {
      const existing = content.slice(startIdx, endIdx + AGENTS_DIRECTIVE_END.length);
      if (existing === block) return; // already up-to-date
      content = content.slice(0, startIdx) + block + content.slice(endIdx + AGENTS_DIRECTIVE_END.length);
      fs.writeFileSync(filePath, content, "utf-8");
      logger.info("openclaw", "Updated Proxima directive block in AGENTS.md");
      return;
    }
  }

  // Prepend block to top of file
  const newContent = content.length > 0 ? block + "\n\n" + content : block + "\n";
  fs.writeFileSync(filePath, newContent, "utf-8");
  logger.info("openclaw", "Injected Proxima directive block into AGENTS.md");
}

// ---------------------------------------------------------------------------
// Skill file seeding
// ---------------------------------------------------------------------------

const SKILL_VERSION_TAG = "proxima-skill";

function getSkillVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function makeSkillHeader(version: string): string {
  return `<!-- ${SKILL_VERSION_TAG}:v${version} -->\n`;
}

function parseSkillVersion(filePath: string): string | null {
  try {
    const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
    const match = firstLine.match(new RegExp(`${SKILL_VERSION_TAG}:v([\\d.]+)`));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function getSkillFiles(): SkillFile[] {
  const dataDir = process.env.PXM_DATA_DIR || "/data";
  return [
    {
      name: "SKILL-proxima-guide.md",
      content: () => `# Proxima Guide

You are running inside **Proxima**, a self-hosted server management platform.
This guide explains how Proxima works and where things live.

## API Access

Proxima API is available via environment variables:
- \`PROXIMA_URL\` — base URL (e.g. \`http://127.0.0.1:20222\`)
- \`PROXIMA_TOKEN\` — Service token with admin privileges (never expires)

All API calls use the \`X-Service-Token\` header:
\`\`\`bash
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" "$PROXIMA_URL/api/..."
\`\`\`

Response format: \`{ "ok": true, "data": ... }\` or \`{ "ok": false, "error": "..." }\`

## Available Proxima Skills

| Skill File | Description |
|------------|-------------|
| SKILL-proxima-guide.md | This file — overview, structure, and API access |
| SKILL-proxima-stacks.md | Docker Compose stack management API |
| SKILL-proxima-routes.md | Reverse proxy routes & domain/DNS management API |
| SKILL-proxima-projects.md | Git repository, script, webhook management API |
| SKILL-proxima-services.md | Users, monitoring, notifications, SSH keys, health checks API |

## Data Directory

\`\`\`
${dataDir}/
├── proxima.db                # SQLite — do not write directly, use API
├── openclaw/                 # OpenClaw state
│   ├── workspace/            # Agent workspace (this directory)
│   └── openclaw.json         # Gateway config
├── stacks/                   # Docker Compose stacks
│   └── {stack-name}/
│       ├── compose.yaml      # Stack definition
│       └── .env              # Stack environment variables
├── repos/                    # Cloned git repositories (configurable path)
└── ssl/                      # SSL certificates
\`\`\`

## Projects (Git Repositories)

- Proxima manages git repositories as "Projects"
- Each project has: local clone path, tracked env files, scripts, webhook config
- Clone path is configurable per project (default under \`${dataDir}/repos/\`)
- Use \`GET /api/repos\` to list all projects and their paths
- Scripts are stored per project and can be executed via API

### Project Scripts

- Scripts are shell scripts registered per project
- Located in the project's clone directory
- Auto-detection: Proxima can suggest scripts from package.json (npm), Makefile, build.gradle, etc.
- Execute via: \`POST /api/repos/{id}/scripts/{slug}/run\`
- Scripts support auto-start on project load and webhook triggers

## Docker Stacks

- Stacks live at \`${dataDir}/stacks/{name}/\`
- Each stack has a \`compose.yaml\` and optional \`.env\`
- Stack lifecycle: create → deploy → start/stop/restart → delete
- Logs available per-service with tail and since filters

## Routes & Domains

- Nginx reverse proxy maps domains → upstream services
- Cloudflare integration for DNS auto-sync and SSL
- Cloudflare Tunnel support for exposing services without port forwarding
- Per-route analytics (traffic, status codes)

## Monitoring & Health

- System metrics: CPU, memory, disk, container count
- Domain health checks with configurable intervals
- Notifications via Telegram, Discord, Slack on health events
- Audit logs for all operations

## Authentication & Roles

- \`admin\`: Full access — user management, script execution, terminals
- \`manager\`: Manage stacks, routes, projects, settings
- \`viewer\`: Read-only access

## Tips

- Always use the API instead of direct file/DB manipulation
- The workspace directory is shared with Proxima's Harness Files UI
- Docker commands work directly if the host socket is mounted
- Use \`GET /api/discovery\` to find running services on the network
- Use \`GET /api/discovery/suggest/{stackName}\` to auto-detect proxy targets
`,
    },
    {
      name: "SKILL-proxima-stacks.md",
      content: () => `# Proxima Docker Stacks API

Manage Docker Compose stacks via Proxima API.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/stacks | List all stacks |
| GET | /api/stacks/{name} | Get stack details with containers |
| PUT | /api/stacks/{name} | Save/update stack |
| DELETE | /api/stacks/{name} | Delete stack |
| POST | /api/stacks/{name}/start | Start stack |
| POST | /api/stacks/{name}/stop | Stop stack |
| POST | /api/stacks/{name}/restart | Restart stack |
| POST | /api/stacks/{name}/deploy | Save and deploy stack |
| GET | /api/stacks/{name}/logs | Get combined logs |
| GET | /api/stacks/{name}/logs/{service} | Get service logs (?tail=200&since=ISO8601) |

## Examples

### List stacks
\`\`\`bash
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" "$PROXIMA_URL/api/stacks"
\`\`\`

### Deploy a new stack
\`\`\`bash
curl -s -X POST -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"yaml":"version: \\"3\\"\\nservices:\\n  web:\\n    image: nginx","env":"","isNew":true}' \\
  "$PROXIMA_URL/api/stacks/my-stack/deploy"
\`\`\`

### Start / Stop / Restart
\`\`\`bash
curl -s -X POST -H "Authorization: Bearer $PROXIMA_TOKEN" "$PROXIMA_URL/api/stacks/{name}/start"
curl -s -X POST -H "Authorization: Bearer $PROXIMA_TOKEN" "$PROXIMA_URL/api/stacks/{name}/stop"
curl -s -X POST -H "Authorization: Bearer $PROXIMA_TOKEN" "$PROXIMA_URL/api/stacks/{name}/restart"
\`\`\`

### Get logs
\`\`\`bash
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" "$PROXIMA_URL/api/stacks/{name}/logs/{service}?tail=100"
\`\`\`

## Stack file location: \`${dataDir}/stacks/{name}/\`
`,
    },
    {
      name: "SKILL-proxima-routes.md",
      content: () => `# Proxima Routes & Reverse Proxy API

Manage Nginx reverse proxy routes and domain connections.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/proxy | List all proxy routes |
| POST | /api/proxy | Create new route |
| PUT | /api/proxy/{id} | Update route |
| DELETE | /api/proxy/{id} | Delete route |
| GET | /api/analytics | Analytics summary for all routes |
| GET | /api/analytics/{proxyHostId} | Analytics for a specific route (?hours=24) |
| GET | /api/discovery | Discover network services |
| GET | /api/discovery/suggest/{stackName} | Suggest proxy target for stack |

## Create Route

\`\`\`bash
curl -s -X POST -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "domainNames": ["app.example.com"],
    "forwardScheme": "http",
    "forwardHost": "127.0.0.1",
    "forwardPort": 3000,
    "blockExploits": true,
    "allowWebsocketUpgrade": false,
    "enabled": true
  }' \\
  "$PROXIMA_URL/api/proxy"
\`\`\`

## Update Route

\`\`\`bash
curl -s -X PUT -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"forwardPort": 8080, "enabled": true}' \\
  "$PROXIMA_URL/api/proxy/{id}"
\`\`\`

## Cloudflare DNS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings/cloudflare | Get Cloudflare config |
| PUT | /api/settings/cloudflare | Update config (apiToken, zones) |
| POST | /api/settings/cloudflare/sync | Sync all DNS records |
| GET | /api/settings/cloudflare/tunnel | Get tunnel settings |
| POST | /api/settings/cloudflare/tunnel/action | Control tunnel (start/stop/restart) |

Route creation with Cloudflare zones auto-syncs DNS records.
`,
    },
    {
      name: "SKILL-proxima-projects.md",
      content: () => `# Proxima Projects (Git Repositories) API

Manage git repositories, branches, scripts, and webhooks.

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/repos | List all repositories |
| GET | /api/repos/{id} | Get repository details |
| DELETE | /api/repos/{id} | Delete repository |
| GET | /api/repos/{id}/status | Git status (dirty/clean) |
| GET | /api/repos/{id}/branches | List remote branches |
| GET | /api/repos/{id}/commits | Commit history (?limit=10) |
| POST | /api/repos/{id}/pull | Pull latest changes |
| POST | /api/repos/{id}/checkout | Checkout branch: {"branch":"main"} |
| POST | /api/repos/{id}/restore | Discard all changes |
| POST | /api/git/clone | Clone repo: {"repoUrl","branch","targetDir"} |

## Environment Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/repos/{id}/env | Read .env (?path=filePath) |
| PUT | /api/repos/{id}/env | Write .env: {"content","path"} |
| GET | /api/repos/{id}/env-files | List tracked env files |
| POST | /api/repos/{id}/env-files | Add env file: {"name","path"} |

## Git Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/repos/{id}/git | Get staged/unstaged/untracked changes |
| POST | /api/repos/{id}/git | Commit: {"action":"commit","message":"..."} |
| POST | /api/repos/{id}/git | Push: {"action":"push"} |

## Scripts

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/repos/{id}/scripts | List scripts |
| POST | /api/repos/{id}/scripts | Create: {"name","content"} |
| PUT | /api/repos/{id}/scripts/{slug} | Update script |
| POST | /api/repos/{id}/scripts/{slug}/run | Execute script |
| GET | /api/repos/{id}/suggest-scripts | Auto-detect scripts |

## Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/repos/{id}/webhook | Get webhook config |
| PUT | /api/repos/{id}/webhook | Update: {"enabled","apiKey"} |

## Examples

### Clone a repository
\`\`\`bash
curl -s -X POST -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"repoUrl":"git@github.com:user/repo.git","branch":"main","targetDir":"/data/repos/my-repo"}' \\
  "$PROXIMA_URL/api/git/clone"
\`\`\`

### Pull latest and check status
\`\`\`bash
curl -s -X POST -H "Authorization: Bearer $PROXIMA_TOKEN" "$PROXIMA_URL/api/repos/{id}/pull"
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" "$PROXIMA_URL/api/repos/{id}/status"
\`\`\`

### Create a script
\`\`\`bash
curl -s -X POST -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"deploy","content":"#!/bin/bash\\necho \\"Deploying...\\"\\ndocker compose pull && docker compose up -d"}' \\
  "$PROXIMA_URL/api/repos/{id}/scripts"
\`\`\`

### Update a script (enable auto-start, webhook trigger)
\`\`\`bash
curl -s -X PUT -H "X-Service-Token: $PROXIMA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"#!/bin/bash\\ngit pull && npm install && npm run build","hookEnabled":true,"autoStart":false}' \\
  "$PROXIMA_URL/api/repos/{id}/scripts/{slug}"
\`\`\`

### Execute a script
\`\`\`bash
curl -s -X POST -H "X-Service-Token: $PROXIMA_TOKEN" \\
  "$PROXIMA_URL/api/repos/{id}/scripts/{slug}/run"
\`\`\`

### Auto-detect scripts from project (package.json, Makefile, etc.)
\`\`\`bash
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" "$PROXIMA_URL/api/repos/{id}/suggest-scripts"
\`\`\`
`,
    },
    {
      name: "SKILL-proxima-services.md",
      content: () => `# Proxima Services & Management API

## Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | List users (admin only) |
| POST | /api/users | Create user: {"username","password","role"} |
| PUT | /api/users/{id} | Update role: {"role"} |
| DELETE | /api/users/{id} | Delete user |

Roles: \`admin\` (full), \`manager\` (manage resources), \`viewer\` (read-only)

## Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/monitoring | Current system metrics (CPU, memory, disk) |
| GET | /api/monitoring/history | Metrics history (?hours=1-24) |
| GET | /api/health | System health check |
| GET | /api/docker/status | Docker connection status |

## Health Checks (Domain Monitoring)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health-checks | List monitored domains |
| POST | /api/health-checks | Add: {"url","name"} |
| PUT | /api/health-checks | Update config |
| DELETE | /api/health-checks | Remove: {"url"} |
| POST | /api/health-checks/check | Manual check: {"urls":["..."]} |

## Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings/notifications | List channels |
| POST | /api/settings/notifications | Create: {"type":"telegram|discord|slack","name","config","enabled"} |
| POST | /api/settings/notifications/{id}/test | Send test notification |

## SSH Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/ssh-keys | List SSH keys |
| POST | /api/ssh-keys/generate | Generate new key: {"alias"} |
| DELETE | /api/ssh-keys/{id} | Delete key |

## GitHub Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/github/status | Check GitHub connection |
| GET | /api/github/authorize | Start OAuth flow |
| POST | /api/github/disconnect | Disconnect GitHub |

## Ports & Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/ports | List listening processes |
| POST | /api/ports/check | Check port reachability: {"ports":[{"port":3000}]} |
| GET | /api/discovery | Discover network services |

## Audit Logs

\`\`\`bash
curl -s -H "X-Service-Token: $PROXIMA_TOKEN" \\
  "$PROXIMA_URL/api/audit-logs?limit=20&category=stack&action=deploy"
\`\`\`

## Branding

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/settings | Get branding settings |
| PUT | /api/settings | Update: {"appName","logoUrl",...} |
`,
    },
  ];
}

/**
 * Seed/update skill reference files in the workspace.
 * - New files are created with a version header.
 * - Existing files are overwritten when the Proxima version changes.
 * - This ensures skill docs stay in sync with the running Proxima version
 *   while preventing user edits from persisting (these are managed files).
 */
function seedSkillFiles(workspaceDir: string): void {
  const skills = getSkillFiles();
  const currentVersion = getSkillVersion();
  let seeded = 0;
  let updated = 0;
  for (const skill of skills) {
    const filePath = path.join(workspaceDir, skill.name);
    const existingVersion = fs.existsSync(filePath) ? parseSkillVersion(filePath) : null;

    if (existingVersion === currentVersion) continue; // up-to-date

    try {
      fs.writeFileSync(filePath, makeSkillHeader(currentVersion) + skill.content(), "utf-8");
      if (existingVersion === null) {
        seeded++;
      } else {
        updated++;
      }
    } catch (err) {
      logger.warn("openclaw", `Failed to write ${skill.name}: ${err}`);
    }
  }
  // Remove deprecated skill files
  const deprecated = ["SKILL-proxima-env.md"];
  for (const name of deprecated) {
    const filePath = path.join(workspaceDir, name);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info("openclaw", `Removed deprecated skill file: ${name}`);
      } catch { /* ignore */ }
    }
  }

  if (seeded > 0) logger.info("openclaw", `Seeded ${seeded} skill file(s) in workspace`);
  if (updated > 0) logger.info("openclaw", `Updated ${updated} skill file(s) to v${currentVersion}`);
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

  // Proxima API access — pass gateway token as service token (no expiry)
  const pxmPort = process.env.PXM_PORT || "20222";
  env.PROXIMA_URL = `http://127.0.0.1:${pxmPort}`;
  env.PROXIMA_TOKEN = token;

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
