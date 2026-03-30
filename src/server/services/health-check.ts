import { getDb, dbHelpers } from "../db/index";
import { notify } from "./notification";
import { logger } from "../lib/logger";

const SETTING_KEY = "health-checks:domains";
const CONFIG_KEY = "health-checks:config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckDomain {
  url: string;
  name: string;
  addedAt: string;
  auto?: boolean;
  notifyEnabled?: boolean;              // default true
  messageTemplate?: string;             // per-domain override
  recoveryMessageTemplate?: string;     // per-domain override
  notificationChannelIds?: number[];    // empty/undefined = all channels
}

export interface HealthCheckConfig {
  enabled: boolean;
  intervalMinutes: number;
  scheduleTimes?: string[];
  mode: "interval" | "schedule";
  messageTemplate?: string;
  recoveryMessageTemplate?: string;
}

export interface HealthCheckResult {
  url: string;
  status: "up" | "down";
  statusCode?: number;
  responseTime: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Default config & templates
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: HealthCheckConfig = {
  enabled: false,
  intervalMinutes: 5,
  mode: "interval",
};

const DEFAULT_DOWN_TEMPLATE =
  "\u{1F534} {domain} is DOWN \u2014 Status: {statusCode}, Response time: {responseTime}ms";
const DEFAULT_RECOVERY_TEMPLATE =
  "\u{1F7E2} {domain} is back UP \u2014 Response time: {responseTime}ms";

// ---------------------------------------------------------------------------
// Domain CRUD (unchanged)
// ---------------------------------------------------------------------------

export function getHealthCheckDomains(): HealthCheckDomain[] {
  const db = getDb();
  const raw = dbHelpers.getSetting(db, SETTING_KEY)?.value;
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export function saveHealthCheckDomains(domains: HealthCheckDomain[]) {
  const db = getDb();
  dbHelpers.setSetting(db, SETTING_KEY, JSON.stringify(domains));
}

/** Auto-register domains when proxy hosts are created */
export function autoRegisterDomains(domainNames: string[]) {
  const domains = getHealthCheckDomains();
  let changed = false;
  for (const name of domainNames) {
    const url = `https://${name}`;
    if (!domains.some((d) => d.url === url)) {
      domains.push({ url, name, addedAt: new Date().toISOString(), auto: true });
      changed = true;
    }
  }
  if (changed) saveHealthCheckDomains(domains);
}

/** Auto-remove domains when proxy hosts are deleted */
export function autoRemoveDomains(domainNames: string[]) {
  const domains = getHealthCheckDomains();
  const urls = new Set(domainNames.map((d) => `https://${d}`));
  const filtered = domains.filter((d) => !urls.has(d.url) || !d.auto);
  if (filtered.length !== domains.length) {
    saveHealthCheckDomains(filtered);
    // Clean up in-memory status for removed domains
    for (const url of urls) {
      domainStatus.delete(url);
    }
  }
}

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

export function getHealthCheckConfig(): HealthCheckConfig {
  try {
    const db = getDb();
    const raw = dbHelpers.getSetting(db, CONFIG_KEY)?.value;
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveHealthCheckConfig(config: HealthCheckConfig) {
  const db = getDb();
  dbHelpers.setSetting(db, CONFIG_KEY, JSON.stringify(config));
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

function buildTemplateVars(domain: HealthCheckDomain, result: HealthCheckResult): Record<string, string> {
  return {
    domain: domain.name,
    url: result.url,
    statusCode: result.statusCode !== undefined ? String(result.statusCode) : "N/A",
    responseTime: String(result.responseTime),
    error: result.error ?? "",
    timestamp: new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, ""),
  };
}

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

/** In-memory status tracking: url -> "up" | "down" */
const domainStatus = new Map<string, "up" | "down">();

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let lastScheduleMinute = "";

// ---------------------------------------------------------------------------
// Core check logic
// ---------------------------------------------------------------------------

async function checkSingleDomain(url: string): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    // Use GET instead of HEAD — some proxies drop connection on HEAD for 5xx
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    // Consume body to avoid memory leak, but don't wait for full download
    res.body?.cancel().catch(() => {});
    clearTimeout(timeout);
    return {
      url,
      status: res.ok ? "up" : "down",
      statusCode: res.status,
      responseTime: Date.now() - start,
    };
  } catch (err) {
    return {
      url,
      status: "down",
      responseTime: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function runScheduledChecks(): Promise<void> {
  const domains = getHealthCheckDomains();
  if (domains.length === 0) return;

  const config = getHealthCheckConfig();
  const globalDownTemplate = config.messageTemplate || DEFAULT_DOWN_TEMPLATE;
  const globalRecoveryTemplate = config.recoveryMessageTemplate || DEFAULT_RECOVERY_TEMPLATE;

  const results = await Promise.all(domains.map((d) => checkSingleDomain(d.url)));

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const result = results[i];
    const previousStatus = domainStatus.get(domain.url);
    const currentStatus = result.status;

    domainStatus.set(domain.url, currentStatus);

    // Skip notification if per-domain notify is disabled
    if (domain.notifyEnabled === false) continue;

    // Only notify on state change (skip first check — no previous status)
    if (previousStatus && previousStatus !== currentStatus) {
      const vars = buildTemplateVars(domain, result);
      const downTemplate = domain.messageTemplate || globalDownTemplate;
      const recoveryTemplate = domain.recoveryMessageTemplate || globalRecoveryTemplate;

      const channelIds = domain.notificationChannelIds?.length ? domain.notificationChannelIds : undefined;
      if (currentStatus === "down") {
        const message = renderTemplate(downTemplate, vars);
        notify({ type: "health.failed", target: domain.url, message, domain: domain.url, channelIds }).catch(() => {});
      } else {
        const message = renderTemplate(recoveryTemplate, vars);
        notify({ type: "health.recovered", target: domain.url, message, domain: domain.url, channelIds }).catch(() => {});
      }
    }
  }

  logger.debug("health-check", `Scheduled check complete: ${results.length} domains checked`);
}

// ---------------------------------------------------------------------------
// Scheduler control
// ---------------------------------------------------------------------------

function stopScheduler() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  lastScheduleMinute = "";
}

function startSchedulerWithConfig(config: HealthCheckConfig) {
  stopScheduler();

  if (!config.enabled) {
    logger.info("health-check", "Scheduled health checks disabled");
    return;
  }

  if (config.mode === "interval") {
    const ms = Math.max(1, config.intervalMinutes) * 60 * 1000;
    logger.info("health-check", `Starting interval health checks every ${config.intervalMinutes} minute(s)`);
    // Run immediately on start, then at interval
    runScheduledChecks().catch((err) =>
      logger.error("health-check", `Scheduled check failed: ${err}`)
    );
    intervalTimer = setInterval(() => {
      runScheduledChecks().catch((err) =>
        logger.error("health-check", `Scheduled check failed: ${err}`)
      );
    }, ms);
  } else if (config.mode === "schedule") {
    const times = config.scheduleTimes ?? [];
    if (times.length === 0) {
      logger.info("health-check", "Schedule mode enabled but no times configured");
      return;
    }
    logger.info("health-check", `Starting scheduled health checks at: ${times.join(", ")}`);
    const timesSet = new Set(times);

    // Check every 30s to avoid missing the first scheduled minute
    const checkSchedule = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const currentMinute = `${hh}:${mm}`;

      // Prevent double-execution within the same minute
      if (currentMinute === lastScheduleMinute) return;

      if (timesSet.has(currentMinute)) {
        lastScheduleMinute = currentMinute;
        runScheduledChecks().catch((err) =>
          logger.error("health-check", `Scheduled check failed: ${err}`)
        );
      }
    };

    // Run immediately to catch current minute, then check every 30s
    checkSchedule();
    scheduleTimer = setInterval(checkSchedule, 30_000);
  }
}

/**
 * Start the health check scheduler. Called once from server.ts after DB init.
 */
export function startHealthCheckScheduler() {
  const config = getHealthCheckConfig();
  startSchedulerWithConfig(config);
}

/**
 * Restart the scheduler with updated config. Called when config is changed via API.
 */
export function restartHealthCheckScheduler() {
  const config = getHealthCheckConfig();
  startSchedulerWithConfig(config);
}
