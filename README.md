<p align="center">
  <img src="public/logo.svg" width="80" height="80" alt="Proxima" />
</p>

<h1 align="center">Proxima</h1>

<p align="center">
  Self-hosted all-in-one cloud infrastructure control panel.<br/>
  Manage Docker Compose stacks, Cloudflare Tunnel reverse proxy, analytics, and Git-based deployments from a single web UI.
</p>

<p align="center">
  <a href="README.ko.md">한국어</a>
</p>

---

## Features

- **Docker Stack Management** — Deploy, start, stop, restart, and delete Docker Compose stacks. Edit Compose YAML and `.env` files in-browser. Real-time container status, logs, and web terminal access.
- **Reverse Proxy (Cloudflare Tunnel)** — Route domains to internal services via Cloudflare Tunnel. Automatic DNS CNAME management and Tunnel ingress sync. SSL is terminated at Cloudflare Edge — no local certificate management needed.
- **Analytics** — Traffic metrics powered by Cloudflare GraphQL Analytics API. View requests, bandwidth, cache hit rate, and country-level traffic.
- **Git Projects & Run Scripts** — Clone repositories via HTTPS or SSH, register custom run scripts, and connect domains directly to running services. Perfect for dev/staging environments.
- **Web Terminal** — Full interactive shell sessions in the browser. Tab-based multi-session support with xterm.js and WebSocket PTY.
- **Server Discovery** — Automatically discover running Docker containers and host processes. Set aliases for processes, track services, and auto-suggest proxy targets.
- **User Management** — Role-based access control (Admin / Manager / Viewer). JWT authentication with setup wizard on first run.
- **Audit Logs** — Track all user activity with category and date filtering. Auto-cleanup after 90 days. Admin-only access.
- **Command Palette** — Quick page navigation with `Cmd+K` / `Ctrl+K`.
- **Branding & Open Graph** — Customize app name, logo, favicon, and Open Graph metadata from the settings page.

---

## Quick Start

### Prerequisites

- Docker and Docker Compose installed
- Cloudflare account (for Tunnel-based reverse proxy)

### Installation

1. Create a `compose.yaml`:

```yaml
services:
  proxima:
    image: jeonhui/proxima:latest
    container_name: proxima
    restart: unless-stopped
    pid: host
    network_mode: host
    environment:
      - PUID=1000  # host user ID (run: id -u)
      - PGID=1000  # host group ID (run: id -g)
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - pxm-data:/data
      - pxm-stacks:/data/stacks

volumes:
  pxm-data:
  pxm-stacks:
```

2. Start the container:

```bash
docker compose up -d
```

3. Open `http://<your-server-ip>:20222` in your browser.

4. The setup wizard will guide you through creating the first admin account.

> **Note:** `network_mode: host` is recommended. Proxima and Cloudflare Tunnel share the host network, so `localhost` routing works directly. No port mapping needed — port `20222` is exposed on the host automatically.
>
> **Firewall:** If your server uses iptables or a cloud security group, make sure port `20222` is open for inbound TCP traffic.

---

## Usage

### Stacks

Navigate to **Stacks** to manage Docker Compose stacks.

- Click **Deploy Stack** to create a new stack with a Compose YAML
- Edit the Compose file and environment variables from the stack detail page
- Use the **Logs** tab for real-time log streaming
- Use the **Terminal** tab to exec into containers

### Routes

Navigate to **Routes** to configure reverse proxy hosts via Cloudflare Tunnel.

1. Go to **Settings > Cloudflare** and configure your API token, zones, and Tunnel token
2. Create routes with domain names pointing to internal services
3. DNS CNAME records and Tunnel ingress rules are synced automatically

> **Important:** Manage all tunnel routes through Proxima only. Adding routes directly in the Cloudflare dashboard will be overwritten when Proxima syncs.

#### Cloudflare API Token Permissions

| Resource | Permission |
|----------|-----------|
| Zone - DNS | **Edit** |
| Zone - Zone | **Read** |
| Zone - Analytics | Read (optional, for dashboard analytics) |
| Account - Cloudflare Tunnel | **Edit** |

Zone Resources must be set to the target zone(s) or "All zones".

### Projects

Navigate to **Projects** to clone Git repositories and run services.

- Clone via HTTPS or SSH (manage SSH keys under **SSH Keys**)
- **Import existing repos** — click **Import** to register git repositories already in `/data/stacks/` (e.g., cloned via terminal)
- Register custom **run scripts** (shell scripts) per repository
- Run scripts start services inside the Proxima container (e.g., `npx next dev -p 3000`)
- Connect a domain via the **Domain** tab — specify port only, host is automatically `localhost`
- The connected domain appears in the project header

#### Domain Connection (Projects)

1. Open a project and go to the **Domain** tab
2. Enter a subdomain (or leave empty to use the project name) and select a zone
3. Enter the port your service runs on (e.g., `3000`)
4. Click **Connect Domain** — DNS and tunnel ingress are configured automatically
5. Optionally check **Use root domain** to use the zone directly (e.g., `example.com`)

### Servers

Navigate to **Servers** to view running containers and host processes.

- **Containers** tab — all Docker containers with ports, networks, volumes
- **Processes** tab — TCP listening processes on the host
- Star (track) services to show them in Route form's service picker
- Set **aliases** for tracked processes to easily identify them when creating routes

### Terminal

Navigate to **Terminal** for standalone shell sessions.

- Create multiple terminal tabs
- Full interactive shell with xterm.js

> **Note:** Host shell access requires **Admin** role.

### Settings

- **Appearance** — Switch between light, dark, and system themes
- **Branding** — Customize app name, logo, favicon, and Open Graph metadata
- **Cloudflare** — Configure API credentials, zones, and Tunnel settings
- **Users** — Manage users and roles (Admin only)
- **Audit Logs** — View all activity logs (Admin only)

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access. Manage users, host shell, view audit logs, all settings. |
| **Manager** | Manage stacks, routes, projects, terminals, and branding. |
| **Viewer** | Read-only access to stacks, routes, and projects. |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PXM_PORT` | `20222` | Server port |
| `PXM_HOSTNAME` | `0.0.0.0` | Server bind address |
| `PXM_DATA_DIR` | `/data` | Data root directory |
| `PXM_STACKS_DIR` | `/data/stacks` | Stack files storage path |
| `PUID` | *(auto-detect)* | Run as this user ID. If unset, detects from `/data` mount owner. |
| `PGID` | *(auto-detect)* | Run as this group ID. If unset, detects from `/data` mount owner. |

### Volumes

| Path | Description |
|------|-------------|
| `/var/run/docker.sock` | Docker socket (required for container management) |
| `/data` | All configuration and database files |
| `/data/stacks` | Docker Compose stack files |
| `/data/init.d/` | User init scripts (`.sh` files, run on container start as proxima user) |

### Init Scripts

Place `.sh` files in `/data/init.d/` to run custom setup on container start. Scripts run as the proxima user with bash.

Example — install Claude Code CLI:
```bash
mkdir -p /path/to/data/init.d
cat > /path/to/data/init.d/01-claude.sh << 'EOF'
#!/bin/bash
grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$HOME/.local/bin:$PATH"
if ! command -v claude >/dev/null 2>&1; then
  curl -fsSL https://claude.ai/install.sh | /bin/bash
fi
EOF
```

---

## Development

```bash
# Install dependencies
npm install

# Start dev server (Next.js + WebSocket server)
npm run dev
```

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server via tsx |
| `npm run build` | Production build (Next.js standalone output) |
| `npm run start` | Run production build |

### Architecture

Proxima runs as a single Node.js process — a custom HTTP server wrapping Next.js with a WebSocket server for terminal connections. There is no separate backend process.

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, @tac-ui/web |
| Backend | Next.js API Routes, Drizzle ORM, Better-SQLite3 |
| Real-time | Server-Sent Events (SSE) for updates, WebSocket for terminals |
| Terminal | xterm.js, node-pty |
| Infrastructure | Docker / Docker Compose, Cloudflare Tunnel |
| Analytics | Cloudflare GraphQL Analytics API |

---

## License

This project is licensed under the [MIT License](LICENSE).
