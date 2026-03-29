import { existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Domain name validation
// ---------------------------------------------------------------------------
const DOMAIN_RE = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export function validateDomainName(domain: string): string {
  if (typeof domain !== "string" || domain.length === 0 || domain.length > 253) {
    throw new Error(`Invalid domain name: ${domain}`);
  }
  if (!DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid domain name format: ${domain}`);
  }
  return domain;
}

// ---------------------------------------------------------------------------
// Location path validation
// ---------------------------------------------------------------------------
const LOCATION_PATH_RE = /^\/[a-zA-Z0-9\/_.\-~]*$/;

export function validateLocationPath(locationPath: string): string {
  if (typeof locationPath !== "string" || locationPath.length === 0) {
    throw new Error("Location path is required");
  }
  if (!LOCATION_PATH_RE.test(locationPath)) {
    throw new Error(`Invalid location path: ${locationPath}`);
  }
  return locationPath;
}

// ---------------------------------------------------------------------------
// Nginx advanced config validation — block dangerous directives
// ---------------------------------------------------------------------------
const DANGEROUS_DIRECTIVES = [
  /\bserver\s*\{/i,
  /\blisten\b/i,
  /\balias\b/i,
  /\bload_module\b/i,
  /\binclude\b/i,
  /\blua_\w*/i,
  /\baccess_by_lua/i,
  /\bcontent_by_lua/i,
  /\brewrite_by_lua/i,
  /\bset_by_lua/i,
  /\bheader_filter_by_lua/i,
  /\bbody_filter_by_lua/i,
  /\blog_by_lua/i,
  /\binit_by_lua/i,
  /\binit_worker_by_lua/i,
];

export function validateAdvancedConfig(config: string): string {
  if (typeof config !== "string") {
    throw new Error("Advanced config must be a string");
  }
  if (config.length === 0) return config;

  for (const pattern of DANGEROUS_DIRECTIVES) {
    if (pattern.test(config)) {
      throw new Error(`Advanced config contains forbidden directive matching: ${pattern.source}`);
    }
  }
  return config;
}

// ---------------------------------------------------------------------------
// Forward host validation — hostname or IP only
// ---------------------------------------------------------------------------
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-_.]*[a-zA-Z0-9])?$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^\[?[a-fA-F0-9:]+\]?$/;

export function validateForwardHost(host: string): string {
  if (typeof host !== "string" || host.length === 0) {
    throw new Error("Forward host is required");
  }
  if (!HOSTNAME_RE.test(host) && !IPV4_RE.test(host) && !IPV6_RE.test(host)) {
    throw new Error(`Invalid forward host: ${host}`);
  }
  return host;
}

// ---------------------------------------------------------------------------
// Forward port validation — 1-65535
// ---------------------------------------------------------------------------
export function validateForwardPort(port: number): number {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid forward port: ${port}. Must be between 1 and 65535`);
  }
  return port;
}

// ---------------------------------------------------------------------------
// Forward scheme validation — http or https only
// ---------------------------------------------------------------------------
const VALID_SCHEMES = new Set(["http", "https"]);

export function validateForwardScheme(scheme: string): string {
  if (typeof scheme !== "string" || !VALID_SCHEMES.has(scheme)) {
    throw new Error(`Invalid forward scheme: ${scheme}. Must be "http" or "https"`);
  }
  return scheme;
}

// ---------------------------------------------------------------------------
// SSH key path validation — absolute path, no special chars, file must exist
// ---------------------------------------------------------------------------
const SSH_PATH_RE = /^\/[a-zA-Z0-9\/_.\-]+$/;

export function validateSshKeyPath(sshKeyPath: string): string {
  if (typeof sshKeyPath !== "string" || sshKeyPath.length === 0) {
    throw new Error("SSH key path is required");
  }
  if (!path.isAbsolute(sshKeyPath)) {
    throw new Error("SSH key path must be an absolute path");
  }
  if (!SSH_PATH_RE.test(sshKeyPath)) {
    throw new Error(`SSH key path contains invalid characters: ${sshKeyPath}`);
  }
  // Prevent path traversal
  const normalized = path.normalize(sshKeyPath);
  if (normalized !== sshKeyPath && normalized !== sshKeyPath + "/") {
    throw new Error("SSH key path contains path traversal");
  }
  if (!existsSync(sshKeyPath)) {
    throw new Error(`SSH key file does not exist: ${sshKeyPath}`);
  }
  return sshKeyPath;
}

// ---------------------------------------------------------------------------
// Validate a location object (from proxy host locations array)
// ---------------------------------------------------------------------------
export function validateLocation(location: Record<string, unknown>): void {
  if (location.path != null) {
    validateLocationPath(location.path as string);
  }
  if (location.forward_host != null) {
    validateForwardHost(location.forward_host as string);
  }
  if (location.forward_port != null) {
    validateForwardPort(location.forward_port as number);
  }
  if (location.forward_scheme != null) {
    validateForwardScheme(location.forward_scheme as string);
  }
  if (location.advanced_config != null) {
    validateAdvancedConfig(location.advanced_config as string);
  }
}

// ---------------------------------------------------------------------------
// PTY environment sanitization — only pass safe env vars
// ---------------------------------------------------------------------------
const PTY_SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "TERM",
  "LANG",
  "USER",
  "NODE_ENV",
  "DOCKER_HOST",
  // SSH / Git
  "GIT_SSH_COMMAND",
  "SSH_AUTH_SOCK",
  // Claude Code / general CLI tools
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "COLORTERM",
  "FORCE_COLOR",
  "HOSTNAME",
  "TZ",
]);

export function sanitizeEnvForPty(extra?: Record<string, string>): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  for (const key of PTY_SAFE_ENV_KEYS) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key] as string;
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (!PTY_SAFE_ENV_KEYS.has(key)) {
        throw new Error(`Environment key "${key}" is not in the PTY safe list`);
      }
      safeEnv[key] = value;
    }
  }
  return safeEnv;
}
