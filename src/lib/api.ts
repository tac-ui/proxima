import type { ApiResponse, StackListItem, Stack, ProxyHost, GitCloneRequest, DiscoveredService, SshKeyInfo, RepositoryInfo, ListeningProcess, AnalyticsData, HostAnalyticsSummary, CloudflareSettingsResponse, CloudflareSettingsPayload, CloudflareTestResult, CloudflareZone, CloudflareTunnelSettingsResponse, CloudflareTunnelSettingsPayload, CloudflaredStatus, User, UserRole, ManagedService, ManagedServiceType, DiscoveredServiceWithManaged, ListeningProcessWithManaged, AuditLogResponse, SystemMetrics, MetricsHistoryResponse, WebhookLog, OpenClawSettings, OpenClawStatus } from "@/types";

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
  getUnregisteredRepos: () => request<{ name: string; repoUrl: string; branch: string }[]>("GET", "/api/repos/import"),
  importRepo: (name: string) => request<RepositoryInfo>("POST", "/api/repos/import", { name }),
  getRepos: () => request<RepositoryInfo[]>("GET", "/api/repos"),
  getRepo: (id: number | string) => request<RepositoryInfo>("GET", `/api/repos/${encodeURIComponent(id)}`),
  updateRepoDomain: (id: number, domainConnection: import("@/types").DomainConnection | null) =>
    request<RepositoryInfo>("PUT", `/api/repos/${id}`, { domainConnection }),
  removeDomain: (id: number, domain: string) =>
    request<RepositoryInfo>("PUT", `/api/repos/${id}`, { removeDomain: domain }),
  deleteRepo: (id: number) => request("DELETE", `/api/repos/${id}`),
  pullRepo: (id: number) => request<{ message: string }>("POST", `/api/repos/${id}/pull`),
  restoreRepo: (id: number) => request<{ message: string }>("POST", `/api/repos/${id}/restore`),
  getRepoStatus: (id: number) => request<{ dirty: boolean; changes: string | null }>("GET", `/api/repos/${id}/status`),
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
  toggleScriptAutoStart: (id: number, slug: string, autoStart: boolean) => request<{ name: string; filename: string; content: string; autoStart?: boolean }>("PUT", `/api/repos/${id}/scripts/${slug}`, { autoStart }),
  deleteRepoScript: (id: number, slug: string) => request("DELETE", `/api/repos/${id}/scripts/${slug}`),
  runRepoScript: (id: number, slug: string) => request<{ terminalId: string }>("POST", `/api/repos/${id}/scripts/${slug}/run`),
  getRepoCommits: (id: number, limit: number = 10) => request<{ commits: { hash: string; shortHash: string; message: string; author: string; date: string }[] }>("GET", `/api/repos/${id}/commits?limit=${limit}`),
  getRepoGit: (id: number) => request<{ changes: { staged: string[]; unstaged: string[]; untracked: string[] }; envFiles: { path: string; tracked: boolean }[] }>("GET", `/api/repos/${id}/git`),
  repoGitCommit: (id: number, message: string) => request<{ message: string }>("POST", `/api/repos/${id}/git`, { action: "commit", message }),
  repoGitPush: (id: number) => request<{ message: string }>("POST", `/api/repos/${id}/git`, { action: "push" }),

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
  updateManagedService: (id: number, data: { alias?: string | null }) => request("PATCH", `/api/managed-services/${id}`, data),
  removeManagedService: (id: number) => request("DELETE", `/api/managed-services/${id}`),
  suggestProxy: (stackName: string) => request("GET", `/api/discovery/suggest/${encodeURIComponent(stackName)}`),

  // Health Checks
  getHealthCheckDomains: () => request<{ url: string; name: string; addedAt: string; auto?: boolean; notifyEnabled?: boolean; messageTemplate?: string; recoveryMessageTemplate?: string; notificationChannelIds?: number[] }[]>("GET", "/api/health-checks"),
  addHealthCheckDomain: (url: string, name: string) => request<{ url: string; name: string; addedAt: string }[]>("POST", "/api/health-checks", { url, name }),
  updateHealthCheckDomain: (url: string, data: { name?: string; newUrl?: string; notifyEnabled?: boolean; messageTemplate?: string; recoveryMessageTemplate?: string; notificationChannelIds?: number[] }) => request<{ url: string; name: string; addedAt: string; auto?: boolean; notifyEnabled?: boolean; messageTemplate?: string; recoveryMessageTemplate?: string; notificationChannelIds?: number[] }[]>("PUT", "/api/health-checks", { url, ...data }),
  removeHealthCheckDomain: (url: string) => request<{ url: string; name: string; addedAt: string }[]>("DELETE", "/api/health-checks", { url }),
  checkHealthDomains: (urls: string[]) => request<{ url: string; status: "up" | "down"; statusCode?: number; responseTime: number; error?: string }[]>("POST", "/api/health-checks/check", { urls }),
  getHealthCheckConfig: () => request<{ enabled: boolean; intervalMinutes: number; scheduleTimes?: string[]; mode: "interval" | "schedule"; messageTemplate?: string; recoveryMessageTemplate?: string }>("GET", "/api/health-checks/config"),
  updateHealthCheckConfig: (config: { enabled?: boolean; intervalMinutes?: number; scheduleTimes?: string[]; mode?: "interval" | "schedule"; messageTemplate?: string; recoveryMessageTemplate?: string }) => request<{ enabled: boolean; intervalMinutes: number; scheduleTimes?: string[]; mode: "interval" | "schedule"; messageTemplate?: string; recoveryMessageTemplate?: string }>("PUT", "/api/health-checks/config", config),

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
  syncAllDns: () => request<{ synced: number; failed: number; errors: string[] }>("POST", "/api/settings/cloudflare/sync"),

  // Notifications
  getNotificationChannels: () => request<{ id: number; type: string; name: string; configSummary: string; enabled: boolean; domainFilter: string[]; createdAt: string }[]>("GET", "/api/settings/notifications"),
  addNotificationChannel: (data: { type: string; name: string; config: Record<string, string>; enabled?: boolean; domainFilter?: string[] }) => request<{ id: number; type: string; name: string; enabled: boolean; domainFilter: string[]; createdAt: string }>("POST", "/api/settings/notifications", data),
  updateNotificationChannel: (id: number, data: { type?: string; name?: string; config?: Record<string, string>; enabled?: boolean; domainFilter?: string[] }) => request<{ id: number; type: string; name: string; enabled: boolean; domainFilter: string[]; createdAt: string }>("PUT", `/api/settings/notifications/${id}`, data),
  deleteNotificationChannel: (id: number) => request("DELETE", `/api/settings/notifications/${id}`),
  testNotificationChannel: (id: number) => request<{ sent: boolean }>("POST", `/api/settings/notifications/${id}/test`),
  discoverTelegramChats: (botToken: string) => request<{
    bot: { name: string; username: string };
    chats: { chatId: string; title: string; type: string; lastMessage?: string; lastMessageDate?: string }[];
  }>("POST", "/api/settings/notifications/telegram-discover", { botToken }),

  // Monitoring
  getStackLogs: (name: string, service?: string) => {
    const params = service ? `?service=${encodeURIComponent(service)}` : "";
    return request<{ logs: string }>("GET", `/api/stacks/${encodeURIComponent(name)}/logs${params}`);
  },
  getServiceLogs: (name: string, service: string, opts?: { tail?: number; since?: string }) => {
    const params = new URLSearchParams();
    if (opts?.tail) params.set("tail", String(opts.tail));
    if (opts?.since) params.set("since", opts.since);
    const qs = params.toString();
    return request<{ logs: string }>("GET", `/api/stacks/${encodeURIComponent(name)}/logs/${encodeURIComponent(service)}${qs ? `?${qs}` : ""}`);
  },
  getSystemMetrics: () => request<SystemMetrics>("GET", "/api/monitoring"),
  getMetricsHistory: (hours: number = 1) => request<MetricsHistoryResponse>("GET", `/api/monitoring/history?hours=${hours}`),

  // Webhook (per-project)
  getWebhookConfig: (id: number) => request<{ hookEnabled: boolean; hookApiKey: string | null }>("GET", `/api/repos/${id}/webhook`),
  updateWebhookConfig: (id: number, body: { enabled: boolean; apiKey?: string }) => request<{ hookEnabled: boolean; hookApiKey: string }>("PUT", `/api/repos/${id}/webhook`, body),
  getWebhookLogs: (id: number, page?: number, limit?: number) => request<{ logs: WebhookLog[]; total: number }>("GET", `/api/repos/${id}/webhook/logs?page=${page ?? 1}&limit=${limit ?? 20}`),

  // OpenClaw
  getOpenClawToken: () => request<{ token: string; port: number }>("GET", "/api/settings/openclaw/token"),
  getOpenClawImportChannels: () => request<{ type: string; name: string; config: Record<string, string> }[]>("GET", "/api/settings/openclaw/import-channels"),
  getOpenClawFiles: () => request<{ name: string; size: number }[]>("GET", "/api/settings/openclaw/files"),
  readOpenClawFile: (name: string) => request<{ name: string; content: string }>("PUT", "/api/settings/openclaw/files", { name }),
  writeOpenClawFile: (name: string, content: string) => request<{ name: string }>("POST", "/api/settings/openclaw/files", { name, content }),
  deleteOpenClawFile: (name: string) => request("DELETE", "/api/settings/openclaw/files", { name }),
  getOpenClawSettings: () => request<OpenClawSettings>("GET", "/api/settings/openclaw"),
  updateOpenClawSettings: (data: Partial<OpenClawSettings>) => request<OpenClawSettings>("PUT", "/api/settings/openclaw", data),
  getOpenClawStatus: () => request<OpenClawStatus>("GET", "/api/settings/openclaw/status"),
  openclawAction: (action: "start" | "stop" | "restart") => request<{ success: boolean; error?: string }>("POST", "/api/settings/openclaw/action", { action }),
};
