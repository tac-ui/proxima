"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input, Select, Skeleton, useToast } from "@tac-ui/web";
import { RefreshCw, Play, Pause, Download, Search, ArrowDown, Copy, Check } from "@tac-ui/icon";
import { useOpenClaw } from "@/contexts/OpenClawContext";

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

interface LogEntry {
  raw: string;
  /** ISO 8601 timestamp if we could extract one. */
  timestamp?: string;
  level?: LogLevel;
  /** Component/scope tag: "gateway", "discord", "telegram", "ws", etc. */
  tag?: string;
  /** Parsed human-readable message body. */
  message: string;
  /** Direction indicator we detected in the message (← inbound / → outbound). */
  direction?: "in" | "out";
  /** Channel the entry relates to, if detectable. */
  channel?: string;
}

const PINO_LEVEL_MAP: Record<number, LogLevel> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

function tryParseJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectChannelAndDirection(message: string): { channel?: string; direction?: "in" | "out" } {
  // Channel detection — look for known tags in the message
  let channel: string | undefined;
  if (message.includes("telegram:") || /\btelegram\b/i.test(message)) channel = "telegram";
  else if (message.includes("discord:") || /\bdiscord\b/i.test(message)) channel = "discord";
  else if (message.includes("webchat:") || /\bwebchat\b/i.test(message)) channel = "webchat";
  else if (message.includes("cli:") || /\bcli\b/i.test(message)) channel = "cli";

  // Direction detection
  let direction: "in" | "out" | undefined;
  if (/\binbound\b|received|\bincoming\b|→.*agent/i.test(message)) direction = "in";
  else if (/\bdelivered\b|\bdeliver\b|sent|outbound|reply/i.test(message)) direction = "out";

  return { channel, direction };
}

function parseLogLine(raw: string): LogEntry {
  // 1) Try pino NDJSON format first (the gateway's default file logger)
  const obj = tryParseJson(raw);
  if (obj) {
    const levelNum = typeof obj.level === "number" ? obj.level : undefined;
    const level = levelNum !== undefined ? PINO_LEVEL_MAP[levelNum] : undefined;
    const msg =
      (typeof obj.msg === "string" ? obj.msg
        : typeof obj.message === "string" ? obj.message
        : "") || "";
    const timeVal = obj.time;
    const timestamp =
      typeof timeVal === "number" ? new Date(timeVal).toISOString()
      : typeof timeVal === "string" ? timeVal
      : undefined;
    const tag =
      (typeof obj.scope === "string" ? obj.scope
        : typeof obj.module === "string" ? obj.module
        : typeof obj.component === "string" ? obj.component
        : undefined);
    const { channel, direction } = detectChannelAndDirection(msg);
    return { raw, timestamp, level, tag, message: msg, direction, channel };
  }

  // 2) Fallback: plain text line. Try to extract timestamp + level prefix.
  // Example shapes:
  //   2026-04-10T14:22:41.209+00:00 [gateway] some message
  //   2026-04-10T14:22:41.211Z INFO  [openclaw] ...
  const plainMatch = raw.match(
    /^(\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)?\s*(?:\[([^\]]+)\])?\s*(.*)$/,
  );
  if (plainMatch) {
    const [, ts, lvl, tag, rest] = plainMatch;
    const message = rest || raw;
    const { channel, direction } = detectChannelAndDirection(message);
    return {
      raw,
      timestamp: ts,
      level: (lvl as LogLevel) || undefined,
      tag,
      message,
      direction,
      channel,
    };
  }

  return { raw, message: raw, ...detectChannelAndDirection(raw) };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type FilterMode = "all" | "messages" | "errors";

interface LogsResponse {
  cursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  reset: boolean;
  file?: string;
}

const REFRESH_INTERVAL_MS = 3000;

// Module-scope caches so switching tabs doesn't briefly show the skeleton
// when the LogViewer remounts — we keep the last-seen entries in memory
// and hydrate state from them on mount. Fresh data from the next poll
// overwrites the cache.
let cachedLogEntries: LogEntry[] = [];
let cachedLogFile: string | undefined = undefined;

export function LogViewer() {
  const { gateway } = useOpenClaw();
  const { toast } = useToast();
  const [entries, setEntries] = useState<LogEntry[]>(() => cachedLogEntries);
  // If we already have cached entries, don't flash the skeleton on mount.
  const [loading, setLoading] = useState(cachedLogEntries.length === 0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [file, setFile] = useState<string | undefined>(() => cachedLogFile);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      toast("Failed to copy", { variant: "error" });
    }
  };

  const firstLoadRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!gateway.connected) {
      setLoading(false);
      return;
    }
    try {
      const result = await gateway.request<LogsResponse>("logs.tail", {
        limit: 500,
      });
      // Filter out empty / whitespace-only lines before parsing so we don't
      // accumulate phantom rows on every poll tick (memory pressure when
      // the tail contains trailing blank lines).
      const rawLines = (result.lines ?? []).filter((l): l is string => {
        return typeof l === "string" && l.trim().length > 0;
      });
      const parsed = rawLines
        .map(parseLogLine)
        // Drop entries whose message body is empty after parsing — they
        // add no information and just inflate render cost.
        .filter(e => e.message.trim().length > 0);
      setEntries(parsed);
      cachedLogEntries = parsed;
      if (result.file) {
        setFile(result.file);
        cachedLogFile = result.file;
      }
      firstLoadRef.current = false;
    } catch (err) {
      // Show toast on first failure so user knows something is wrong.
      // After first load, suppress to avoid spamming during transient errors.
      if (firstLoadRef.current) {
        toast(err instanceof Error ? err.message : "Failed to fetch logs", { variant: "error" });
        firstLoadRef.current = false;
      }
    } finally {
      setLoading(false);
    }
  }, [gateway, toast]);

  // Initial load + auto-refresh timer
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  // Subscribe to real-time events so logs update immediately on messages.
  // Debounce to avoid hammering logs.tail during streaming (chat events
  // fire on every token delta).
  useEffect(() => {
    if (!gateway.connected) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { refresh(); }, 500);
    };
    const unsubs = [
      gateway.subscribe("chat.final", debouncedRefresh),
      gateway.subscribe("chat.delta", debouncedRefresh),
      gateway.subscribe("sessions.changed", () => { refresh(); }),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      unsubs.forEach(u => u());
    };
  }, [gateway, refresh]);

  // Tail-follow: after each update, scroll to the bottom if the user hasn't
  // scrolled up manually.
  useEffect(() => {
    if (!autoScroll) return;
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, autoScroll]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // If the user is within ~40px of the bottom we consider them "following".
    setAutoScroll(distanceFromBottom < 40);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filter === "errors" && e.level !== "ERROR" && e.level !== "WARN" && e.level !== "FATAL") {
        return false;
      }
      if (filter === "messages") {
        const m = e.message.toLowerCase();
        const isChannelEvent =
          m.includes("discord:") || m.includes("telegram:")
          || m.includes("webchat:") || m.includes("inbound")
          || m.includes("delivered") || m.includes("chat.send")
          || m.includes("reply") || m.includes("outbound");
        if (!isChannelEvent) return false;
      }
      if (q && !e.raw.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, filter, search]);

  const handleDownload = () => {
    const text = entries.map(e => e.raw).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openclaw-logs-${Date.now()}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-36">
          <Select
            size="sm"
            options={[
              { value: "all", label: "All entries" },
              { value: "messages", label: "Messages only" },
              { value: "errors", label: "Errors only" },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as FilterMode)}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <Input
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder="Search logs..."
            size="sm"
            leftIcon={<Search size={12} />}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refresh}
          disabled={loading || !gateway.connected}
          leftIcon={<RefreshCw size={12} className={loading ? "animate-spin" : ""} />}
          title="Refresh now"
        >
          Refresh
        </Button>
        <Button
          variant={autoRefresh ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setAutoRefresh(v => !v)}
          leftIcon={autoRefresh ? <Pause size={12} /> : <Play size={12} />}
          title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}
        >
          {autoRefresh ? "Auto" : "Paused"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDownload}
          disabled={entries.length === 0}
          leftIcon={<Download size={12} />}
          title="Download .log file"
        >
          Export
        </Button>
      </div>

      {/* Log view */}
      <div className="relative">
        <motion.div
          ref={logContainerRef}
          onScroll={onScroll}
          className="rounded-lg border border-border bg-muted/10 font-mono text-[10px] max-h-[520px] overflow-y-auto"
        >
          {loading && entries.length === 0 ? (
            <div className="p-3 space-y-1.5">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} height={10} width={`${70 + (i % 3) * 10}%`} />
              ))}
            </div>
          ) : !gateway.connected && entries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-xs">
              Gateway disconnected — start OpenClaw to view logs.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-xs">
              {entries.length === 0 ? "No log entries yet." : "No entries match the current filter."}
            </p>
          ) : (
            <div className="divide-y divide-border/40">
              {filtered.map((e, i) => {
                const key = `${i}-${e.timestamp ?? ""}`;
                const isExpanded = expandedKey === key;
                const isCopied = copiedKey === key;
                const levelClass =
                  e.level === "ERROR" || e.level === "FATAL" ? "bg-error/5 border-l-2 border-l-error"
                  : e.level === "WARN" ? "bg-warning/5 border-l-2 border-l-warning"
                  : e.level === "DEBUG" || e.level === "TRACE" ? "opacity-70"
                  : "";
                const levelBadge =
                  e.level === "ERROR" || e.level === "FATAL" ? "text-error"
                  : e.level === "WARN" ? "text-warning"
                  : e.level === "DEBUG" || e.level === "TRACE" ? "text-muted-foreground"
                  : "text-info";
                const channelColor =
                  e.channel === "telegram" ? "text-[#26A5E4]"
                  : e.channel === "discord" ? "text-[#5865F2]"
                  : e.channel === "webchat" ? "text-point"
                  : "text-muted-foreground";
                const dirArrow =
                  e.direction === "in" ? "←"
                  : e.direction === "out" ? "→"
                  : "·";
                // Pretty-print JSON when possible
                let prettyRaw = e.raw;
                try {
                  const parsed = JSON.parse(e.raw);
                  prettyRaw = JSON.stringify(parsed, null, 2);
                } catch { /* keep raw */ }
                return (
                  <div key={key} className={`${levelClass}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedKey(isExpanded ? null : key)}
                      className={`w-full px-2.5 py-1.5 flex flex-col gap-0.5 text-left hover:bg-muted/30 transition-colors ${isExpanded ? "bg-muted/30" : ""}`}
                    >
                      {/* Meta row: timestamp + level + channel/direction + tag */}
                      <div className="flex items-center gap-2 text-[9px]">
                        <span className="text-muted-foreground tabular-nums shrink-0" title={e.timestamp}>
                          {e.timestamp
                            ? new Date(e.timestamp).toLocaleTimeString(undefined, {
                                hour12: false,
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : "—"}
                        </span>
                        {e.level && (
                          <span className={`font-bold uppercase shrink-0 ${levelBadge}`}>
                            {e.level}
                          </span>
                        )}
                        {e.channel && (
                          <span className={`shrink-0 flex items-center gap-0.5 uppercase ${channelColor}`}>
                            <span>{dirArrow}</span>
                            <span>{e.channel}</span>
                          </span>
                        )}
                        {e.tag && !e.channel && (
                          <span className="text-muted-foreground shrink-0">[{e.tag}]</span>
                        )}
                      </div>
                      {/* Message row: full width, truncate when collapsed, wrap when expanded */}
                      <div
                        className={`text-foreground leading-snug ${
                          isExpanded
                            ? "whitespace-pre-wrap break-words"
                            : "truncate"
                        }`}
                      >
                        {e.message}
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="px-2.5 pb-2 pt-1 space-y-1 border-t border-border/40">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Raw entry</span>
                              <button
                                type="button"
                                onClick={(evt) => {
                                  evt.stopPropagation();
                                  handleCopy(key, e.raw);
                                }}
                                className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded border border-border bg-background"
                                title="Copy raw log line"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={10} className="text-success" />
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <Copy size={10} />
                                    Copy
                                  </>
                                )}
                              </button>
                            </div>
                            <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all bg-muted/40 rounded p-2 max-h-[200px] overflow-auto">
                              {prettyRaw}
                            </pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Jump-to-bottom floating button when user scrolled up */}
        {!autoScroll && entries.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              const el = logContainerRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute bottom-3 right-3 w-8 h-8 rounded-full border border-border bg-background shadow-md flex items-center justify-center hover:border-foreground/40 transition-colors"
            title="Jump to latest"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Showing {filtered.length} of {entries.length} entries
          {autoRefresh && " · refreshing every 3s"}
        </span>
        {file && <span className="font-mono truncate max-w-[240px]" title={file}>{file}</span>}
      </div>
    </div>
  );
}
