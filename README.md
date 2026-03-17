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
- **Git Clone & Deploy** — Clone repositories via HTTPS or SSH, auto-detect `docker-compose` files, and deploy as stacks with one click. Manage SSH keys and run custom scripts per repository.
- **Web Terminal** — Full interactive shell sessions in the browser. Tab-based multi-session support with xterm.js and WebSocket PTY.
- **Network Discovery** — Automatically discover running Docker containers and their internal IPs/ports. Auto-suggest proxy targets when creating routes.
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
    pid: host  # optional: enables host process discovery
    ports:
      - "20222:20222"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - pxm-data:/data
      - pxm-stacks:/data/stacks
    networks:
      - pxm-network

networks:
  pxm-network:
    name: pxm-network

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

> **Using an existing reverse proxy?** Only expose port `20222` and point your proxy to `localhost:20222`.

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

1. Go to **Settings > Cloudflare** and configure your API token, Zone ID, and Tunnel token
2. Create proxy hosts with domain names pointing to internal services
3. DNS CNAME records and Tunnel ingress rules are synced automatically

### Projects

Navigate to **Projects** to clone Git repositories and deploy them.

- Clone via HTTPS or SSH (manage SSH keys under **SSH Keys**)
- Auto-detect `docker-compose` files in cloned repos
- Deploy detected Compose files as stacks with one click
- Register and run custom scripts per repository

### Terminal

Navigate to **Terminal** for standalone shell sessions.

- Create multiple terminal tabs
- Full interactive shell with xterm.js

### Settings

- **Appearance** — Switch between light, dark, and system themes
- **Branding** — Customize app name, logo, favicon, and Open Graph metadata
- **Cloudflare** — Configure API credentials and Tunnel settings

### User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access. Manage users, view audit logs, all settings. |
| **Manager** | Manage stacks, routes, projects, terminals, and branding. |
| **Viewer** | Read-only access to stacks, routes, and projects. |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PXM_PORT` | `20222` | Server port |
| `PXM_DATA_DIR` | `/data` | Data root directory |
| `PXM_STACKS_DIR` | `/data/stacks` | Stack files storage path |
| `PXM_HOST_DATA_DIR` | same as `PXM_DATA_DIR` | Host path for data dir (needed for Cloudflare Tunnel bind mounts) |

### Volumes

| Path | Description |
|------|-------------|
| `/var/run/docker.sock` | Docker socket (required for container management) |
| `/data` | All configuration and database files |
| `/data/stacks` | Docker Compose stack files |

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
