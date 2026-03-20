import type { ApiResponse, StackListItem, Stack, ProxyHost, GitCloneRequest, DiscoveredService, SshKeyInfo, RepositoryInfo, ListeningProcess, AnalyticsData, HostAnalyticsSummary, CloudflareSettingsResponse, CloudflareSettingsPayload, CloudflareTestResult, CloudflareZone, CloudflareTunnelSettingsResponse, CloudflareTunnelSettingsPayload, CloudflaredStatus, User, UserRole, ManagedService, ManagedServiceType, DiscoveredServiceWithManaged, ListeningProcessWithManaged, AuditLogResponse, SystemMetrics, MetricsHistoryResponse, WebhookLog } from "@/types";

const TOKEN_KEY = "proxima_auth_token";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  try {
    const token = getToken();
    const res = await fetch(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // Clear invalid token on 401 and reload to show login/setup
    if (res.status === 401 && token) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.reload();
      return { ok: false, error: "Session expired" };
    }
    const contentType = res.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return { ok: false, error: `Unexpected response (${res.status})` };
    }
    return await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export const api = {
  // Auth
  checkNeedSetup: () => request<boolean>("GET", "/api/auth/check"),
  login: (username: string, password: string) => request<{ token: string }>("POST", "/api/auth/login", { username, password }),
  setup: (username: string, password: string) => request<{ token: string }>("POST", "/api/auth/setup", { username, password }),
  verify: () => request<{ userId: number; username: string; role: string }>("GET", "/api/auth/verify"),

  // Users
  getUsers: () => request<User[]>("GET", "/api/users"),
  createUser: (username: string, password: string, role: UserRole) => request<User>("POST", "/api/users", { username, password, role }),
  updateUserRole: (id: number, role: UserRole) => request<User>("PUT", `/api/users/${id}`, { role }),
  deleteUser: (id: number) => request("DELETE", `/api/users/${id}`),
  changePassword: (currentPassword: string, newPassword: string) => request("PUT", "/api/users/me/password", { currentPassword, newPassword }),

  // Docker
  getDockerStatus: () => request<{ connected: boolean; error?: string }>("GET", "/api/docker/status"),

  // Stacks
  getStacks: () => request<StackListItem[]>("GET", "/api/stacks"),
  getStack: (name: string) => request<Stack>("GET", `/api/stacks/${encodeURIComponent(name)}`),
  deployStack: (name: string, yaml: string, env: string, isNew: boolean, dockerfiles?: Record<string, string>) => request("POST", `/api/stacks/${encodeURIComponent(name)}/deploy`, { yaml, env, isNew, dockerfiles }),
  saveStack: (name: string, yaml: string, env: string, isNew: boolean, dockerfiles?: Record<string, string>) => request("PUT", `/api/stacks/${encodeURIComponent(name)}`, { yaml, env, isNew, dockerfiles }),
  startStack: (name: string) => request("POST", `/api/stacks/${encodeURIComponent(name)}/start`),
  stopStack: (name: string) => request("POST", `/api/stacks/${encodeURIComponent(name)}/stop`),
  restartStack: (name: string) => request("POST", `/api/stacks/${encodeURIComponent(name)}/restart`),
  deleteStack: (name: string) => request("DELETE", `/api/stacks/${encodeURIComponent(name)}`),

  // Routes
  getRoutes: () => request<ProxyHost[]>("GET", "/api/proxy"),
  createRoute: (data: Partial<ProxyHost>) => request<ProxyHost>("POST", "/api/proxy", data),
  updateRoute: (id: number, data: Partial<ProxyHost>) => request<ProxyHost>("PUT", `/api/proxy/${id}`, data),
  deleteRoute: (id: number) => request("DELETE", `/api/proxy/${id}`),

  // Git
  cloneRepo: (req: GitCloneRequest) => request<{ path: string; composeFiles: string[] }>("POST", "/api/git/clone", req),

  // Repos
  getRepos: () => request<RepositoryInfo[]>("GET", "/api/repos"),
  getRepo: (id: number | string) => request<RepositoryInfo>("GET", `/api/repos/${encodeURIComponent(id)}`),
  deleteRepo: (id: number) => request("DELETE", `/api/repos/${id}`),
  pullRepo: (id: number) => request<{ message: string }>("POST", `/api/repos/${id}/pull`),
  getRepoEnv: (id: number, filePath: string = ".env") => request<{ content: string }>("GET", `/api/repos/${id}/env?path=${encodeURIComponent(filePath)}`),
  updateRepoEnv: (id: number, content: string, filePath: string = ".env") => request("PUT", `/api/repos/${id}/env`, { content, path: filePath }),
  getRepoEnvFiles: (id: number) => request<{ envFiles: { name: string; path: string }[] }>("GET", `/api/repos/${id}/env-files`),
  addRepoEnvFile: (id: number, name: string, filePath: string) => request<{ envFiles: { name: string; path: string }[] }>("POST", `/api/repos/${id}/env-files`, { name, path: filePath }),
  removeRepoEnvFile: (id: number, filePath: string) => request<{ envFiles: { name: string; path: string }[] }>("DELETE", `/api/repos/${id}/env-files`, { path: filePath }),
  checkoutBranch: (id: number, branch: string) => request<{ message: string; branch: string }>("POST", `/api/repos/${id}/checkout`, { branch }),
  getRepoBranches: (id: number) => request<{ branches: string[]; current: string }>("GET", `/api/repos/${id}/branches`),
  getSuggestedScripts: (id: number) => request<{ suggestions: { name: string; command: string; preCommand?: string }[] }>("GET", `/api/repos/${id}/suggest-scripts`),
  getRepoScripts: (id: number) => request<{ name: string; filename: string }[]>("GET", `/api/repos/${id}/scripts`),
  createRepoScript: (id: number, name: string, content?: string) => request<{ name: string; filename: string; content: string }>("POST", `/api/repos/${id}/scripts`, { name, content }),
  getRepoScript: (id: number, slug: string) => request<{ name: string; filename: string; content: string }>("GET", `/api/repos/${id}/scripts/${slug}`),
  updateRepoScript: (id: number, slug: string, content: string, name?: string) => request<{ name: string; filename: string; content: string; hookEnabled?: boolean }>("PUT", `/api/repos/${id}/scripts/${slug}`, { content, ...(name ? { name } : {}) }),
  toggleScriptHook: (id: number, slug: string, hookEnabled: boolean) => request<{ name: string; filename: string; content: string; hookEnabled?: boolean }>("PUT", `/api/repos/${id}/scripts/${slug}`, { hookEnabled }),
  deleteRepoScript: (id: number, slug: string) => request("DELETE", `/api/repos/${id}/scripts/${slug}`),
  runRepoScript: (id: number, slug: string) => request<{ terminalId: string }>("POST", `/api/repos/${id}/scripts/${slug}/run`),
  getRepoCommits: (id: number, limit: number = 10) => request<{ commits: { hash: string; shortHash: string; message: string; author: string; date: string }[] }>("GET", `/api/repos/${id}/commits?limit=${limit}`),

  // SSH Keys
  getSshKeys: () => request<SshKeyInfo[]>("GET", "/api/ssh-keys"),
  addSshKey: (alias: string, keyPath: string) => request<SshKeyInfo>("POST", "/api/ssh-keys", { alias, keyPath }),
  removeSshKey: (id: number) => request("DELETE", `/api/ssh-keys/${id}`),
  generateSshKey: (alias: string) => request<SshKeyInfo & { publicKey: string }>("POST", "/api/ssh-keys/generate", { alias }),
  getSshPublicKey: (id: number) => request<{ publicKey: string | null }>("GET", `/api/ssh-keys/${id}/public-key`),

  // Discovery
  discoverServices: () => request<DiscoveredServiceWithManaged[]>("GET", "/api/discovery"),

  // Ports
  getListeningPorts: () => request<ListeningProcessWithManaged[]>("GET", "/api/ports"),
  checkPorts: (ports: { host?: string; port: number }[]) => request<{ results: Record<number, boolean> }>("POST", "/api/ports/check", { ports }),

  // Managed Services
  getManagedServices: () => request<ManagedService[]>("GET", "/api/managed-services"),
  addManagedService: (type: ManagedServiceType, identifier: string) => request<ManagedService>("POST", "/api/managed-services", { type, identifier }),
  removeManagedService: (id: number) => request("DELETE", `/api/managed-services/${id}`),
  suggestProxy: (stackName: string) => request("GET", `/api/discovery/suggest/${encodeURIComponent(stackName)}`),

  // GitHub
  getGithubStatus: () => request<{ connected: boolean; username?: string }>("GET", "/api/github/status"),
  disconnectGithub: () => request("POST", "/api/github/disconnect"),

  // Branding
  getBranding: () => request<{ appName: string; logoUrl: string; faviconUrl: string; showLogo: boolean; showAppName: boolean; ogTitle: string; ogDescription: string }>("GET", "/api/settings"),
  updateBranding: (data: { appName?: string; logoUrl?: string; faviconUrl?: string; showLogo?: boolean; showAppName?: boolean; ogTitle?: string; ogDescription?: string }) => request<{ appName: string; logoUrl: string; faviconUrl: string; showLogo: boolean; showAppName: boolean; ogTitle: string; ogDescription: string }>("PUT", "/api/settings", data),
  uploadLogo: async (file: File): Promise<ApiResponse<{ logoUrl: string }>> => {
    const token = getToken();
    const formData = new FormData();
    formData.append("logo", file);
    const res = await fetch("/api/settings/logo", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    return res.json();
  },
  deleteLogo: () => request("DELETE", "/api/settings/logo"),
  uploadFavicon: async (file: File): Promise<ApiResponse<{ faviconUrl: string }>> => {
    const token = getToken();
    const formData = new FormData();
    formData.append("favicon", file);
    const res = await fetch("/api/settings/favicon", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    return res.json();
  },
  deleteFavicon: () => request("DELETE", "/api/settings/favicon"),

  // Analytics
  getAnalyticsSummary: () => request<HostAnalyticsSummary[]>("GET", "/api/analytics"),
  getAnalytics: (proxyHostId: number, hours: number = 24) => request<AnalyticsData>("GET", `/api/analytics/${proxyHostId}?hours=${hours}`),

  // Cloudflare DNS
  getCloudflareSettings: () => request<CloudflareSettingsResponse>("GET", "/api/settings/cloudflare"),
  updateCloudflareSettings: (data: CloudflareSettingsPayload) => request<CloudflareSettingsResponse>("PUT", "/api/settings/cloudflare", data),
  testCloudflareConnection: () => request<CloudflareTestResult>("POST", "/api/settings/cloudflare", {}),
  testCloudflareZone: (zoneId: string, apiToken?: string) =>
    request<CloudflareTestResult>("POST", "/api/settings/cloudflare", { zoneId, ...(apiToken ? { apiToken } : {}) }),
  fetchCloudflareZones: (apiToken?: string) =>
    request<CloudflareZone[]>("POST", "/api/settings/cloudflare", { action: "listZones", ...(apiToken ? { apiToken } : {}) }),

  // Terminals
  getActiveTerminals: () => request<{ id: string; type: "shell" | "repo" }[]>("GET", "/api/terminals"),
  killTerminal: (id: string) => request("DELETE", `/api/terminals/${encodeURIComponent(id)}`),
  createShellTerminal: () => request<{ terminalId: string }>("POST", "/api/terminals/shell"),

  // Audit Logs
  getAuditLogs: (params?: { page?: number; limit?: number; category?: string; userId?: number; action?: string; startDate?: string; endDate?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.category) query.set("category", params.category);
    if (params?.userId) query.set("userId", String(params.userId));
    if (params?.action) query.set("action", params.action);
    if (params?.startDate) query.set("startDate", params.startDate);
    if (params?.endDate) query.set("endDate", params.endDate);
    return request<AuditLogResponse>("GET", `/api/audit-logs?${query.toString()}`);
  },

  // Cloudflare Tunnel
  getTunnelSettings: () => request<CloudflareTunnelSettingsResponse>("GET", "/api/settings/cloudflare/tunnel"),
  updateTunnelSettings: (data: CloudflareTunnelSettingsPayload) => request<CloudflareTunnelSettingsResponse>("PUT", "/api/settings/cloudflare/tunnel", data),
  getCloudflaredStatus: () => request<CloudflaredStatus>("GET", "/api/settings/cloudflare/tunnel/status"),
  tunnelAction: (action: "start" | "stop" | "restart") =>
    request<{ success: boolean }>("POST", "/api/settings/cloudflare/tunnel/action", { action }),

  // Monitoring
  getStackLogs: (name: string) => request<{ logs: string }>("GET", `/api/stacks/${encodeURIComponent(name)}/logs`),
  getSystemMetrics: () => request<SystemMetrics>("GET", "/api/monitoring"),
  getMetricsHistory: (hours: number = 1) => request<MetricsHistoryResponse>("GET", `/api/monitoring/history?hours=${hours}`),

  // Webhook (per-project)
  getWebhookConfig: (id: number) => request<{ hookEnabled: boolean; hookApiKey: string | null }>("GET", `/api/repos/${id}/webhook`),
  updateWebhookConfig: (id: number, body: { enabled: boolean; apiKey?: string }) => request<{ hookEnabled: boolean; hookApiKey: string }>("PUT", `/api/repos/${id}/webhook`, body),
  getWebhookLogs: (id: number, page?: number, limit?: number) => request<{ logs: WebhookLog[]; total: number }>("GET", `/api/repos/${id}/webhook/logs?page=${page ?? 1}&limit=${limit ?? 20}`),
};
