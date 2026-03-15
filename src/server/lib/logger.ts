export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",   // cyan
  info: "\x1b[32m",    // green
  warn: "\x1b[33m",    // yellow
  error: "\x1b[31m",   // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function getCurrentLevel(): number {
  const envLevel = (process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel;
  return LOG_LEVELS[envLevel] ?? LOG_LEVELS.info;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, module: string, message: unknown): string {
  const ts = formatTimestamp();
  const color = COLORS[level];
  const levelStr = level.toUpperCase().padEnd(5);
  const msg = typeof message === "object" ? JSON.stringify(message, null, 2) : String(message);
  return `${DIM}${ts}${RESET} ${color}${BOLD}${levelStr}${RESET} ${DIM}[${module}]${RESET} ${msg}`;
}

function write(level: LogLevel, module: string, message: unknown): void {
  if (LOG_LEVELS[level] < getCurrentLevel()) {
    return;
  }
  const formatted = formatMessage(level, module, message);
  if (level === "error" || level === "warn") {
    process.stderr.write(formatted + "\n");
  } else {
    process.stdout.write(formatted + "\n");
  }
}

export const logger = {
  debug(module: string, message: unknown): void {
    write("debug", module, message);
  },
  info(module: string, message: unknown): void {
    write("info", module, message);
  },
  warn(module: string, message: unknown): void {
    write("warn", module, message);
  },
  error(module: string, message: unknown): void {
    write("error", module, message);
  },
};
