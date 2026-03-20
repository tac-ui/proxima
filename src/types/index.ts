// === Stack Types (from Dockge) ===
export type StackStatus =
  | "created"    // compose file exists but not running
  | "running"    // containers are up
  | "exited"     // containers stopped
  | "partial"    // some containers running
  | "unknown";

export interface MountInfo {
  type: string;        // "bind" | "volume" | "tmpfs"
  source: string;      // host path or volume name
  destination: string; // container path
  mode: string;        // "rw" | "ro" etc.
  rw: boolean;
}

export interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  image: string;
  ports: PortMapping[];
  networks: NetworkInfo[];
  mounts: MountInfo[];
}

export interface PortMapping {
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface NetworkInfo {
  name: string;
  ipAddress: string;
  gateway: string;
}

export interface Stack {
  id: number;
  name: string;
  status: StackStatus;
  composeYAML: string;
  composeENV: string;
  dockerfiles: Record<string, string>;
  containers: ContainerInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface StackListItem {
  name: string;
  status: StackStatus;
  containerCount: number;
  updatedAt: string;
}

// === Proxy Types ===
export interface ProxyHost {
  id: number;
  domainNames: string[];
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
  cachingEnabled: boolean;
  blockExploits: boolean;
  allowWebsocketUpgrade: boolean;
  http2Support: boolean;
  enabled: boolean;
  meta: Record<string, unknown>;
  locations: ProxyLocation[];
  createdAt: string;
  updatedAt: string;
}

export interface ProxyLocation {
  path: string;
  forwardScheme: "http" | "https";
  forwardHost: string;
  forwardPort: number;
}

// === Git Types ===
export interface GitCloneRequest {
  repoUrl: string;
  branch?: string;
  sshKeyPath?: string;
  targetDir: string;
}

export interface GitCloneProgress {
  stage: string;
  progress: number;
  total: number;
}

// === Listening Process Types ===
export interface ListeningProcess {
  pid: number;
  name: string;
  user: string;
  port: number;
  address: string;
  protocol: string;
}

// === Network Discovery Types ===
export interface DiscoveredService {
  containerName: string;
  serviceName: string;
  stackName: string;
  internalIp: string;
  ports: PortMapping[];
  networks: string[];
  mounts: MountInfo[];
}

// === Managed Service Types ===
export type ManagedServiceType = "container" | "process";

export interface ManagedService {
  id: number;
  type: ManagedServiceType;
  identifier: string;
  autoManaged: boolean;
}

export interface DiscoveredServiceWithManaged extends DiscoveredService {
  managed: boolean;
  managedId?: number;
}

export interface ListeningProcessWithManaged extends ListeningProcess {
  managed: boolean;
  managedId?: number;
}

// === Socket Event Types ===
export interface ServerToClientEvents {
  stackList: (stacks: StackListItem[]) => void;
  stackStatus: (name: string, status: StackStatus) => void;
  terminalWrite: (terminalId: string, data: string) => void;
  terminalExit: (terminalId: string, exitCode: number) => void;
  proxyHostList: (hosts: ProxyHost[]) => void;
  discoveredServices: (services: DiscoveredService[]) => void;
  gitProgress: (progress: GitCloneProgress) => void;
  error: (message: string) => void;
  needSetup: (need: boolean) => void;
}

export interface ClientToServerEvents {
  // Stack operations
  deployStack: (name: string, yaml: string, env: string, isNew: boolean, cb: (res: ApiResponse) => void) => void;
  saveStack: (name: string, yaml: string, env: string, isNew: boolean, cb: (res: ApiResponse) => void) => void;
  startStack: (name: string, cb: (res: ApiResponse) => void) => void;
  stopStack: (name: string, cb: (res: ApiResponse) => void) => void;
  restartStack: (name: string, cb: (res: ApiResponse) => void) => void;
  deleteStack: (name: string, cb: (res: ApiResponse) => void) => void;
  getStack: (name: string, cb: (res: ApiResponse<Stack>) => void) => void;
  requestStackList: (cb: (res: ApiResponse<StackListItem[]>) => void) => void;

  // Terminal operations
  terminalJoin: (terminalId: string, cb: (res: ApiResponse<{ buffer: string }>) => void) => void;
  terminalInput: (terminalId: string, input: string) => void;
  terminalResize: (terminalId: string, rows: number, cols: number) => void;

  // Proxy operations
  createProxyHost: (data: Partial<ProxyHost>, cb: (res: ApiResponse<ProxyHost>) => void) => void;
  updateProxyHost: (id: number, data: Partial<ProxyHost>, cb: (res: ApiResponse<ProxyHost>) => void) => void;
  deleteProxyHost: (id: number, cb: (res: ApiResponse) => void) => void;
  requestProxyHostList: (cb: (res: ApiResponse<ProxyHost[]>) => void) => void;

  // Git operations
  gitClone: (request: GitCloneRequest, cb: (res: ApiResponse) => void) => void;

  // Network discovery
  discoverServices: (cb: (res: ApiResponse<DiscoveredService[]>) => void) => void;

  // Auth
  login: (username: string, password: string, cb: (res: ApiResponse<{ token: string }>) => void) => void;
  setup: (username: string, password: string, cb: (res: ApiResponse<{ token: string }>) => void) => void;
  loginByToken: (token: string, cb: (res: ApiResponse<{ userId: number; username: string }>) => void) => void;
  checkNeedSetup: (cb: (needSetup: boolean) => void) => void;

  // GitHub OAuth
  getGithubStatus: (cb: (res: ApiResponse<{ connected: boolean; username?: string }>) => void) => void;
  disconnectGithub: (cb: (res: ApiResponse) => void) => void;

  // SSH Keys
  listSshKeys: (cb: (res: ApiResponse<SshKeyInfo[]>) => void) => void;
  addSshKey: (alias: string, keyPath: string, cb: (res: ApiResponse<SshKeyInfo>) => void) => void;
  removeSshKey: (id: number, cb: (res: ApiResponse) => void) => void;

  // Repositories
  listRepos: (cb: (res: ApiResponse<RepositoryInfo[]>) => void) => void;
  getRepo: (id: number, cb: (res: ApiResponse<RepositoryInfo>) => void) => void;
  createRepoScript: (repoId: number, name: string, content: string, cb: (res: ApiResponse<RepositoryInfo>) => void) => void;
  deleteRepoScript: (repoId: number, slug: string, cb: (res: ApiResponse) => void) => void;
  runRepoScript: (repoId: number, slug: string, cb: (res: ApiResponse<{ terminalId: string }>) => void) => void;
  deleteRepo: (id: number, cb: (res: ApiResponse) => void) => void;
}

export interface ApiResponse<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

// === User Types ===
export type UserRole = "admin" | "manager" | "viewer";

export interface User {
  id: number;
  username: string;
  role: UserRole;
  createdAt: string;
}

// === SSH Key Types ===
export interface SshKeyInfo {
  id: number;
  alias: string;
  keyPath: string;
}

// === Repository Types ===
export interface RepoScript {
  name: string;
  filename: string;
  hookEnabled?: boolean;
}

export interface RepoScriptDetail extends RepoScript {
  content: string;
}

export interface RepoEnvFile {
  name: string;  // Display name (e.g. "Backend Production")
  path: string;  // Relative path (e.g. "backend/.env.production")
}

export interface RepositoryInfo {
  id: number;
  name: string;
  repoUrl: string;
  path: string;
  branch: string;
  scripts: RepoScript[];
  envFiles: RepoEnvFile[];
  hookEnabled: boolean;
  hookApiKey: string | null;
}

export interface WebhookLog {
  id: number;
  repoId: number;
  scriptName: string;
  status: string;
  exitCode: number | null;
  terminalId: string | null;
  ipAddress: string | null;
  duration: number | null;
  createdAt: string;
}

// === Analytics Types ===
export interface AnalyticsBucket {
  bucket: string;
  totalRequests: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  bytesSent: number;
  uniqueVisitors: number;
}

export interface AnalyticsData {
  buckets: AnalyticsBucket[];
  summary: {
    totalRequests: number;
    status2xx: number;
    status3xx: number;
    status4xx: number;
    status5xx: number;
    bytesSent: number;
    uniqueVisitors: number;
    errorRate: number;
  };
  topPaths: { path: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
}

export interface HostAnalyticsSummary {
  proxyHostId: number;
  totalRequests: number;
  errorRate: number;
}

// === Cloudflare DNS Types ===
export interface CloudflareZone {
  zoneId: string;
  zoneName: string; // e.g. "example.com"
}

export interface CloudflareSettingsResponse {
  apiToken: string;
  zones: CloudflareZone[];
  autoSync: boolean;
  defaultZone?: string;
}

export interface CloudflareSettingsPayload {
  apiToken: string;
  zones: CloudflareZone[];
  autoSync: boolean;
  defaultZone?: string;
}

export interface CloudflareTestResult {
  valid: boolean;
  zoneName?: string;
  error?: string;
}

// === Cloudflare Tunnel Types ===
export interface CloudflareTunnelSettingsResponse {
  enabled: boolean;
  tunnelId: string;
  tunnelName: string;
  accountId: string;
  tunnelToken: string; // masked
}

export interface CloudflareTunnelSettingsPayload {
  enabled: boolean;
  tunnelToken: string;
}

// === Audit Log Types ===
export interface AuditLog {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetName: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  total: number;
}

// === System Metrics Types ===
export interface SystemMetrics {
  cpu: { model: string; cores: number; loadAvg: [number, number, number] };
  memory: { totalBytes: number; freeBytes: number; usedBytes: number; usagePercent: number };
  disk: { totalBytes: number; usedBytes: number; availableBytes: number; usagePercent: number; mountPoint: string };
  os: { type: string; platform: string; release: string; arch: string; hostname: string };
  uptime: { seconds: number; formatted: string };
  timestamp: string;
}

// === Metrics History Types ===
export interface MetricsHistoryPoint {
  timestamp: string;
  cpuLoad: number;
  memoryPercent: number;
  diskPercent: number;
}

export interface MetricsHistoryResponse {
  points: MetricsHistoryPoint[];
}

// === Cloudflared Container Types ===
export interface CloudflaredStatus {
  state: "running" | "stopped" | "not_found" | "restarting" | "error";
  containerId?: string;
  error?: string;
  logs?: string;
}
