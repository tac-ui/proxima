# Proxima MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the Proxima management API as tools, so an MCP-capable agent (Claude Desktop,
Claude Code, etc.) can drive Proxima — manage Docker stacks, reverse-proxy
routes, git projects, scripts, webhooks, monitoring, and more.

It replaces the previous "Proxima guide" skill files: instead of reading
markdown and hand-crafting `curl` calls, the agent calls typed tools.

## Setup

```bash
cd mcp
npm install
```

### Get a token

In Proxima, go to **Settings → MCP**, enable the MCP server, and copy the
service token. The token grants admin-level API access and, by default, is
**only accepted from localhost** (`local-only` mode) — so run this server on the
same host as Proxima.

### Configure

Set environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROXIMA_URL` | `http://127.0.0.1:3000` | Base URL of the Proxima instance (`PROXIMA_BASE_URL` also accepted) |
| `PROXIMA_TOKEN` | — | Service token from Settings → MCP (`PROXIMA_API_TOKEN` also accepted) |

### Run

```bash
PROXIMA_URL=http://127.0.0.1:3000 PROXIMA_TOKEN=xxxxx npm start
```

## Client configuration

Claude Desktop / Claude Code (`mcpServers` entry):

```json
{
  "mcpServers": {
    "proxima": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/proxima/mcp/index.ts"],
      "env": {
        "PROXIMA_URL": "http://127.0.0.1:3000",
        "PROXIMA_TOKEN": "your-service-token"
      }
    }
  }
}
```

## Tools

Stacks: `list_stacks`, `get_stack`, `deploy_stack`, `control_stack`, `delete_stack`, `get_stack_logs`
Routes: `list_routes`, `create_route`, `update_route`, `delete_route`, `get_route_analytics`
Projects: `list_projects`, `get_project`, `get_project_status`, `pull_project`, `clone_project`, `list_scripts`, `run_script`
Webhooks: `get_project_webhook`, `set_project_webhook`
Monitoring: `get_metrics`, `get_health`, `get_docker_status`, `discover_services`, `list_ports`
Health/notifications: `list_health_checks`, `list_notification_channels`, `test_notification`
Users/audit: `list_users`, `query_audit_logs`
Escape hatch: `proxima_request` (call any endpoint directly)

## Security

- The token authenticates as an admin service account (`mcp`). Treat it like a password.
- Local-only mode (default) rejects the token unless the request reaches Proxima
  over a loopback connection with no proxy/forwarding headers — so even if Proxima
  is exposed via a tunnel, the token can't be replayed from outside the host.
- Rotate the token any time from Settings → MCP; the old token stops working immediately.
