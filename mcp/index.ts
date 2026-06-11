#!/usr/bin/env -S npx tsx
/**
 * Proxima MCP server.
 *
 * Exposes the Proxima management REST API as Model Context Protocol tools over
 * stdio. Authenticates with a long-lived service token (the `X-Service-Token`
 * header) issued from Proxima's Settings → MCP panel.
 *
 * Configuration (environment variables):
 *   PROXIMA_URL    Base URL of the Proxima instance (default http://127.0.0.1:3000).
 *                  PROXIMA_BASE_URL is also accepted.
 *   PROXIMA_TOKEN  Service token. PROXIMA_API_TOKEN is also accepted.
 *
 * The token is local-only by default on the Proxima side, so this server is
 * meant to run on the same host as Proxima.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.PROXIMA_URL || process.env.PROXIMA_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const TOKEN = process.env.PROXIMA_TOKEN || process.env.PROXIMA_API_TOKEN || "";

if (!TOKEN) {
  console.error("[proxima-mcp] Missing PROXIMA_TOKEN. Set it from Proxima → Settings → MCP.");
  process.exit(1);
}

type Json = unknown;

interface ApiOk { ok: true; data?: Json }
interface ApiErr { ok: false; error?: string }

/** Call the Proxima REST API and unwrap its `{ ok, data | error }` envelope. */
async function callApi(method: string, path: string, body?: Json): Promise<Json> {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { "X-Service-Token": TOKEN };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Network error calling ${method} ${path}: ${(err as Error).message}. Is Proxima running at ${BASE_URL}?`);
  }

  const text = await res.text();
  let parsed: ApiOk | ApiErr | Json;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${method} ${path}: ${text.slice(0, 300)}`);
    return text;
  }

  if (parsed && typeof parsed === "object" && "ok" in parsed) {
    const env = parsed as ApiOk | ApiErr;
    if (env.ok === false) {
      throw new Error(env.error || `Request failed: ${method} ${path} (HTTP ${res.status})`);
    }
    return (env as ApiOk).data ?? null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${method} ${path}`);
  return parsed;
}

const server = new McpServer({ name: "proxima", version: "1.0.0" });

/** Register a tool whose handler returns JSON, serialised into a text block. */
function tool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>) => Promise<Json>,
): void {
  server.registerTool(
    name,
    { description, inputSchema },
    async (args: z.objectOutputType<S, z.ZodTypeAny>) => {
      try {
        const data = await handler(args);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}

const enc = encodeURIComponent;

// --- Docker stacks ---------------------------------------------------------
tool("list_stacks", "List all Docker Compose stacks.", {}, () => callApi("GET", "/api/stacks"));
tool("get_stack", "Get a stack's details and containers.", { name: z.string() },
  ({ name }) => callApi("GET", `/api/stacks/${enc(name)}`));
tool("deploy_stack", "Save and deploy a stack (compose YAML + optional env). Set isNew=true to create.", {
  name: z.string(), yaml: z.string(), env: z.string().optional(), isNew: z.boolean().optional(),
}, ({ name, yaml, env, isNew }) => callApi("POST", `/api/stacks/${enc(name)}/deploy`, { yaml, env: env ?? "", isNew: isNew ?? false }));
tool("control_stack", "Start, stop, or restart a stack.", {
  name: z.string(), action: z.enum(["start", "stop", "restart"]),
}, ({ name, action }) => callApi("POST", `/api/stacks/${enc(name)}/${action}`));
tool("delete_stack", "Delete a stack.", { name: z.string() },
  ({ name }) => callApi("DELETE", `/api/stacks/${enc(name)}`));
tool("get_stack_logs", "Get logs for a stack, optionally for a single service.", {
  name: z.string(), service: z.string().optional(), tail: z.number().optional(), since: z.string().optional(),
}, ({ name, service, tail, since }) => {
  const qs = new URLSearchParams();
  if (tail) qs.set("tail", String(tail));
  if (since) qs.set("since", since);
  const q = qs.toString() ? `?${qs}` : "";
  const path = service ? `/api/stacks/${enc(name)}/logs/${enc(service)}${q}` : `/api/stacks/${enc(name)}/logs${q}`;
  return callApi("GET", path);
});

// --- Reverse proxy routes --------------------------------------------------
tool("list_routes", "List all reverse proxy routes.", {}, () => callApi("GET", "/api/proxy"));
tool("create_route", "Create a reverse proxy route.", {
  domainNames: z.array(z.string()),
  forwardScheme: z.enum(["http", "https"]).optional(),
  forwardHost: z.string(),
  forwardPort: z.number(),
  blockExploits: z.boolean().optional(),
  allowWebsocketUpgrade: z.boolean().optional(),
  enabled: z.boolean().optional(),
}, (args) => callApi("POST", "/api/proxy", {
  forwardScheme: "http", blockExploits: true, allowWebsocketUpgrade: false, enabled: true, ...args,
}));
tool("update_route", "Update a reverse proxy route by id.", {
  id: z.number(), patch: z.record(z.any()),
}, ({ id, patch }) => callApi("PUT", `/api/proxy/${id}`, patch));
tool("delete_route", "Delete a reverse proxy route by id.", { id: z.number() },
  ({ id }) => callApi("DELETE", `/api/proxy/${id}`));
tool("get_route_analytics", "Analytics for all routes, or a single route by id.", {
  proxyHostId: z.number().optional(), hours: z.number().optional(),
}, ({ proxyHostId, hours }) => {
  const q = hours ? `?hours=${hours}` : "";
  return callApi("GET", proxyHostId ? `/api/analytics/${proxyHostId}${q}` : "/api/analytics");
});

// --- Projects (git repositories) ------------------------------------------
tool("list_projects", "List all git repository projects.", {}, () => callApi("GET", "/api/repos"));
tool("get_project", "Get a project's details by id.", { id: z.number() },
  ({ id }) => callApi("GET", `/api/repos/${id}`));
tool("get_project_status", "Get git status (dirty/clean) for a project.", { id: z.number() },
  ({ id }) => callApi("GET", `/api/repos/${id}/status`));
tool("pull_project", "Pull latest changes for a project.", { id: z.number() },
  ({ id }) => callApi("POST", `/api/repos/${id}/pull`));
tool("clone_project", "Clone a git repository.", {
  repoUrl: z.string(), branch: z.string().optional(), targetDir: z.string().optional(),
}, (args) => callApi("POST", "/api/git/clone", args));
tool("list_scripts", "List a project's run scripts.", { id: z.number() },
  ({ id }) => callApi("GET", `/api/repos/${id}/scripts`));
tool("run_script", "Execute a project script by slug/filename.", { id: z.number(), slug: z.string() },
  ({ id, slug }) => callApi("POST", `/api/repos/${id}/scripts/${enc(slug)}/run`));

// --- Webhooks --------------------------------------------------------------
tool("get_project_webhook", "Get a project's webhook config.", { id: z.number() },
  ({ id }) => callApi("GET", `/api/repos/${id}/webhook`));
tool("set_project_webhook", "Enable/disable a project's webhook and set its API key.", {
  id: z.number(), enabled: z.boolean(), apiKey: z.string().optional(),
}, ({ id, enabled, apiKey }) => callApi("PUT", `/api/repos/${id}/webhook`, { enabled, apiKey }));

// --- Monitoring & discovery ------------------------------------------------
tool("get_metrics", "Current system metrics (CPU, memory, disk).", {}, () => callApi("GET", "/api/monitoring"));
tool("get_health", "System health check.", {}, () => callApi("GET", "/api/health"));
tool("get_docker_status", "Docker connection status.", {}, () => callApi("GET", "/api/docker/status"));
tool("discover_services", "Discover running services on the network.", {}, () => callApi("GET", "/api/discovery"));
tool("list_ports", "List listening processes/ports on the host.", {}, () => callApi("GET", "/api/ports"));

// --- Health checks & notifications ----------------------------------------
tool("list_health_checks", "List monitored domains.", {}, () => callApi("GET", "/api/health-checks"));
tool("list_notification_channels", "List notification channels.", {}, () => callApi("GET", "/api/settings/notifications"));
tool("test_notification", "Send a test notification to a channel by id.", { id: z.number() },
  ({ id }) => callApi("POST", `/api/settings/notifications/${id}/test`));

// --- Users & audit ---------------------------------------------------------
tool("list_users", "List users (admin).", {}, () => callApi("GET", "/api/users"));
tool("query_audit_logs", "Query audit logs with optional filters.", {
  limit: z.number().optional(), category: z.string().optional(), action: z.string().optional(),
}, ({ limit, category, action }) => {
  const qs = new URLSearchParams();
  if (limit) qs.set("limit", String(limit));
  if (category) qs.set("category", category);
  if (action) qs.set("action", action);
  const q = qs.toString() ? `?${qs}` : "";
  return callApi("GET", `/api/audit-logs${q}`);
});

// --- Generic escape hatch --------------------------------------------------
tool("proxima_request", "Call any Proxima API endpoint directly. Use when no specific tool fits.", {
  method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]),
  path: z.string().describe("API path, e.g. /api/stacks"),
  body: z.any().optional().describe("JSON request body for write methods"),
}, ({ method, path, body }) => callApi(method, path, body));

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[proxima-mcp] connected — proxying ${BASE_URL}`);
}

main().catch((err) => {
  console.error("[proxima-mcp] fatal:", err);
  process.exit(1);
});
