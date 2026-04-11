"use client";

import React, { useMemo, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Badge, Skeleton } from "@tac-ui/web";
import {
  BrainCircuit,
  Cpu,
  Wifi,
  MessageSquare,
  ChevronRight,
  CheckCircle2,
  Circle,
  Activity,
  ArrowUpRight,
  X,
} from "@tac-ui/icon";

const CHECKLIST_DISMISS_KEY = "openclaw.dashboard.checklist.dismissed";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import type { OpenClawModels } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDefaultModel(config: Record<string, unknown> | null): string {
  if (!config) return "";
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const model = defaults?.model;
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "primary" in (model as Record<string, unknown>)) {
    return (model as Record<string, string>).primary ?? "";
  }
  return "";
}

function hasAnyApiKey(models: OpenClawModels | undefined | null): boolean {
  if (!models) return false;
  return Object.values(models).some((v) => typeof v === "string" && v.length > 0);
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  icon: React.ReactElement;
  children: React.ReactNode;
  accent?: "success" | "warning" | "error" | "default";
  onClick?: () => void;
  ariaLabel?: string;
}

function StatCard({ label, icon, children, accent = "default", onClick, ariaLabel }: StatCardProps) {
  const borderClass =
    accent === "success" ? "border-success/30 bg-success/5"
    : accent === "warning" ? "border-warning/30 bg-warning/5"
    : accent === "error" ? "border-error/30 bg-error/5"
    : "border-border bg-muted/20";
  const hoverClass = onClick
    ? "cursor-pointer hover:border-foreground/40 hover:bg-muted/40 group/stat"
    : "";

  const content = (
    <>
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase tracking-wide">
        {icon}
        <span className="flex-1">{label}</span>
        {onClick && (
          <ArrowUpRight
            size={12}
            className="opacity-0 group-hover/stat:opacity-100 transition-opacity"
          />
        )}
      </div>
      <div className="mt-1">{children}</div>
    </>
  );

  if (onClick) {
    return (
      <motion.button
        type="button"
        layout
        onClick={onClick}
        aria-label={ariaLabel ?? label}
        className={`rounded-xl border px-3 py-3 text-left transition-colors ${borderClass} ${hoverClass}`}
      >
        {content}
      </motion.button>
    );
  }
  return (
    <motion.div layout className={`rounded-xl border px-3 py-3 ${borderClass}`}>
      {content}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Quick-start checklist
// ---------------------------------------------------------------------------

interface ChecklistStep {
  id: string;
  label: string;
  hint: string;
  done: boolean;
  targetTab?: string;
}

function QuickStartChecklist({
  steps,
  onNavigate,
  onDismiss,
}: {
  steps: ChecklistStep[];
  onNavigate: (tab: string) => void;
  onDismiss: () => void;
}) {
  const completed = steps.filter(s => s.done).length;
  const allDone = completed === steps.length;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border border-dashed border-point/30 bg-point/5 p-4 space-y-3 relative"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss get started checklist"
        title="Dismiss"
        className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <X size={12} />
      </button>
      <div className="flex items-center gap-2 pr-6">
        <div className="w-8 h-8 rounded-lg bg-point/15 flex items-center justify-center">
          <BrainCircuit size={16} className="text-point" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {allDone ? "Everything looks ready" : "Get started"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {allDone
              ? "Your OpenClaw is configured — try sending a message."
              : `${completed} of ${steps.length} steps complete`}
          </p>
        </div>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, i) => (
          <li key={step.id}>
            <button
              type="button"
              disabled={!step.targetTab}
              onClick={() => step.targetTab && onNavigate(step.targetTab)}
              className="w-full flex items-center gap-2 p-2 rounded-lg text-left hover:bg-background/60 disabled:hover:bg-transparent transition-colors group/step"
            >
              {step.done ? (
                <CheckCircle2 size={14} className="text-success shrink-0" />
              ) : (
                <Circle size={14} className="text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${step.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}>
                  {i + 1}. {step.label}
                </p>
                {!step.done && (
                  <p className="text-[10px] text-muted-foreground">{step.hint}</p>
                )}
              </div>
              {step.targetTab && !step.done && (
                <ChevronRight size={12} className="text-muted-foreground group-hover/step:text-foreground shrink-0 transition-colors" />
              )}
            </button>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Recent activity feed
// ---------------------------------------------------------------------------

interface ActivityEntry {
  ts: string;
  channel?: string;
  direction?: "in" | "out";
  message: string;
  level?: "INFO" | "WARN" | "ERROR";
}

function parseActivityLine(raw: string): ActivityEntry | null {
  // Guard against blank / whitespace-only lines — they would otherwise
  // create phantom "empty" entries every poll tick.
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Filter for interesting lines: channel messages, agent runs, errors,
  // and gateway lifecycle events (so the feed isn't empty when the user
  // has the bot connected but nobody's chatting).
  const lower = trimmed.toLowerCase();
  const isChannelEvent =
    trimmed.includes("discord:")
    || trimmed.includes("telegram:")
    || trimmed.includes("webchat:")
    || trimmed.includes("inbound")
    || trimmed.includes("delivered")
    || trimmed.includes("chat.send")
    || trimmed.includes("reply");
  const isGatewayEvent =
    lower.includes("[gateway]")
    || lower.includes("gateway ready")
    || lower.includes("gateway started")
    || lower.includes("gateway restart")
    || lower.includes("gateway stopping")
    || lower.includes("starting channels")
    || lower.includes("config.patch");
  const isError = /\berror\b|\bwarn\b/i.test(trimmed) && !lower.includes("dangerous config flags");
  if (!isChannelEvent && !isGatewayEvent && !isError) return null;

  // Try pino JSON
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const msg = (obj.msg as string) ?? (obj.message as string) ?? "";
    if (!msg) return null;
    const lvlNum = obj.level as number | undefined;
    const level =
      lvlNum === 50 || lvlNum === 60 ? "ERROR" as const
      : lvlNum === 40 ? "WARN" as const
      : "INFO" as const;
    const ts = typeof obj.time === "number" ? new Date(obj.time).toISOString() : new Date().toISOString();
    return {
      ts,
      message: msg,
      level,
      channel: msg.includes("discord") ? "discord" : msg.includes("telegram") ? "telegram" : msg.includes("webchat") ? "webchat" : undefined,
      direction: /inbound|received/.test(msg) ? "in" : /delivered|reply|outbound/.test(msg) ? "out" : undefined,
    };
  } catch { /* fallthrough */ }

  // Plain text parse
  const tsMatch = raw.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\b/);
  const ts = tsMatch?.[1] ?? new Date().toISOString();
  const levelMatch = raw.match(/\b(ERROR|WARN|INFO)\b/);
  return {
    ts,
    message: raw,
    level: (levelMatch?.[1] as ActivityEntry["level"]) ?? "INFO",
    channel: raw.includes("discord") ? "discord" : raw.includes("telegram") ? "telegram" : raw.includes("webchat") ? "webchat" : undefined,
    direction: /inbound|received/.test(raw) ? "in" : /delivered|reply|outbound/.test(raw) ? "out" : undefined,
  };
}

// Module-scope cache so tab switches don't flash "No recent activity" —
// we hydrate from the last seen entries and refresh in the background.
let cachedActivityEntries: ActivityEntry[] = [];

function RecentActivity({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { gateway } = useOpenClaw();
  const [entries, setEntries] = useState<ActivityEntry[]>(() => cachedActivityEntries);
  const [loaded, setLoaded] = useState(cachedActivityEntries.length > 0);

  const refresh = useCallback(async () => {
    if (!gateway.connected) return;
    try {
      const result = await gateway.request<{ lines: string[] }>("logs.tail", { limit: 200 });
      const parsed: ActivityEntry[] = [];
      for (let i = (result.lines ?? []).length - 1; i >= 0 && parsed.length < 5; i--) {
        const entry = parseActivityLine(result.lines[i]);
        if (entry) parsed.unshift(entry);
      }
      setEntries(parsed);
      cachedActivityEntries = parsed;
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [gateway]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!gateway.connected) return null;

  return (
    <motion.div layout className="rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Activity size={12} className="text-muted-foreground" />
        <p className="text-xs font-medium">Recent activity</p>
        <span className="text-[10px] text-muted-foreground ml-auto">live</span>
      </div>
      {!loaded ? (
        <div className="p-3 space-y-1.5">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={12} />)}
        </div>
      ) : entries.length === 0 ? (
        <button
          type="button"
          onClick={() => onNavigate("logs")}
          className="w-full px-3 py-4 text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          No recent channel activity. Open Logs tab for full gateway output →
        </button>
      ) : (
        <>
          <ul className="divide-y divide-border/50">
            {entries.map((e, i) => {
              const channelColor =
                e.channel === "telegram" ? "text-[#26A5E4]"
                : e.channel === "discord" ? "text-[#5865F2]"
                : e.channel === "webchat" ? "text-point"
                : "text-muted-foreground";
              const arrow = e.direction === "in" ? "←" : e.direction === "out" ? "→" : "·";
              const time = new Date(e.ts).toLocaleTimeString(undefined, {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              return (
                <li
                  key={`${i}-${e.ts}`}
                  className={`px-3 py-1.5 flex items-start gap-2 text-[11px] font-mono ${
                    e.level === "ERROR" ? "bg-error/5" : e.level === "WARN" ? "bg-warning/5" : ""
                  }`}
                >
                  <span className="text-muted-foreground tabular-nums shrink-0">{time}</span>
                  {e.channel && (
                    <span className={`shrink-0 uppercase ${channelColor}`}>
                      {arrow} {e.channel}
                    </span>
                  )}
                  <span className="flex-1 truncate text-muted-foreground" title={e.message}>
                    {e.message}
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => onNavigate("logs")}
            className="w-full border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors flex items-center justify-center gap-1"
          >
            View full logs <ChevronRight size={10} />
          </button>
        </>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

interface DashboardProps {
  onNavigate: (tab: string) => void;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { gateway, config, configLoading, channels, sessions, settings } = useOpenClaw();

  const defaultModel = useMemo(() => extractDefaultModel(config), [config]);

  const configuredChannels = channels.filter(c => c.configured);
  const connectedChannels = configuredChannels.filter(c => c.status === "connected");

  // Dismissible quick-start checklist. We persist the dismissal flag in
  // localStorage so the user's choice sticks across reloads. Hydration is
  // guarded so SSR/first render matches the "not dismissed" state.
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(CHECKLIST_DISMISS_KEY);
      if (stored === "1") setChecklistDismissed(true);
    } catch { /* ignore — private mode, etc. */ }
  }, []);
  const dismissChecklist = () => {
    setChecklistDismissed(true);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(CHECKLIST_DISMISS_KEY, "1");
      }
    } catch { /* ignore */ }
  };

  // Show the checklist when the user hasn't completed the full setup loop
  // AND they haven't manually dismissed it. Also hide it while the gateway
  // is reconnecting / disconnected — the checklist inputs (config, channels)
  // are stale at that point, so it would either flash false-positive "not
  // done" items or simply look out of place next to the skeletons on the
  // Setup tab.
  const hasKey = hasAnyApiKey(settings?.models);
  const hasModel = defaultModel.length > 0;
  const hasChannel = configuredChannels.length > 0;
  const hasConnectedChannel = connectedChannels.length > 0;
  const setupIncomplete = !hasKey || !hasModel || !hasChannel || !hasConnectedChannel;
  const gatewayReady = gateway.connected && !gateway.reconnecting;
  const showChecklist = gatewayReady && setupIncomplete && !checklistDismissed;

  const steps: ChecklistStep[] = [
    {
      id: "key",
      label: "Register an API key",
      hint: "Add Anthropic / OpenAI / OpenRouter key in Credentials",
      done: hasKey,
      targetTab: "credentials",
    },
    {
      id: "model",
      label: "Pick a default model",
      hint: "Choose one in Setup → Model",
      done: hasModel,
      targetTab: "setup",
    },
    {
      id: "channel",
      label: "Configure a messaging channel",
      hint: "Telegram or Discord bot in Setup → Channels",
      done: hasChannel,
      targetTab: "setup",
    },
    {
      id: "connected",
      label: "Wait for the channel to go live",
      hint: "The status dot should turn green",
      done: hasConnectedChannel,
      targetTab: "setup",
    },
  ];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      {/* Quick-start checklist (only while setup is incomplete and not dismissed) */}
      {showChecklist && (
        <QuickStartChecklist
          steps={steps}
          onNavigate={onNavigate}
          onDismiss={dismissChecklist}
        />
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Gateway"
          icon={<BrainCircuit size={12} />}
          accent={gateway.reconnecting ? "warning" : gateway.connected ? "success" : "warning"}
        >
          <p className="text-sm font-medium truncate">
            {gateway.reconnecting ? "Reconnecting…" : gateway.connected ? "Connected" : "Disconnected"}
          </p>
          <p className="text-[10px] text-muted-foreground truncate">
            {gateway.reconnecting
              ? "Restoring connection"
              : gateway.connected
                ? "Ready to accept requests"
                : "Waiting for connection"}
          </p>
        </StatCard>

        <StatCard
          label="Default Model"
          icon={<Cpu size={12} />}
          onClick={() => onNavigate("setup")}
          ariaLabel="Default Model — click to edit in Setup"
        >
          {config === null && configLoading ? (
            <Skeleton width={140} height={14} />
          ) : (
            <>
              <p className="text-sm font-medium font-mono truncate" title={defaultModel || undefined}>
                {defaultModel || <span className="text-muted-foreground font-sans italic">Not set</span>}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {defaultModel ? "Click to change" : "Pick a model in Setup"}
              </p>
            </>
          )}
        </StatCard>

        <StatCard
          label="Channels"
          icon={<Wifi size={12} />}
          accent={
            configuredChannels.length === 0 ? "default"
              : connectedChannels.length === 0 ? "error"
              : connectedChannels.length === configuredChannels.length ? "success"
              : "warning"
          }
          onClick={() => onNavigate("setup")}
          ariaLabel="Channels — click to manage in Setup"
        >
          {configuredChannels.length === 0 ? (
            <>
              <p className="text-sm font-medium text-muted-foreground italic">None configured</p>
              <p className="text-[10px] text-muted-foreground">Click to connect one</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium tabular-nums">
                <span className={connectedChannels.length === 0 ? "text-error" : connectedChannels.length === configuredChannels.length ? "text-success" : "text-warning"}>
                  {connectedChannels.length}
                </span>
                <span className="text-muted-foreground"> live</span>
              </p>
              <p className="text-[10px] text-muted-foreground">
                of {configuredChannels.length} configured
              </p>
            </>
          )}
        </StatCard>

        <StatCard
          label="Sessions"
          icon={<MessageSquare size={12} />}
          onClick={() => onNavigate("sessions")}
          ariaLabel="Sessions — click to view"
        >
          <p className="text-sm font-medium tabular-nums">{sessions.length}</p>
          <p className="text-[10px] text-muted-foreground">
            {sessions.length === 0
              ? "No active sessions"
              : sessions.length === 1 ? "1 active · click to view" : `${sessions.length} active · click to view`}
          </p>
        </StatCard>
      </div>

      {/* Channel status list */}
      {channels.length > 0 && (
        <motion.div
          layout
          className="rounded-xl border border-border overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Wifi size={12} className="text-muted-foreground" />
            <p className="text-xs font-medium">Channel status</p>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {connectedChannels.length} of {configuredChannels.length || channels.length} live
            </span>
          </div>
          <div className="divide-y divide-border">
            {channels.map((ch) => {
              const dotClass =
                ch.status === "error" ? "bg-error"
                : !ch.configured ? "bg-muted-foreground/30"
                : ch.enabled === false ? "bg-muted-foreground/30"
                : ch.status === "connected" ? "bg-success"
                : "bg-warning";
              const badgeLabel =
                ch.status === "error" ? "Error"
                : !ch.configured ? "Not configured"
                : ch.enabled === false ? "Disabled"
                : ch.status === "connected" ? "Connected"
                : "Disconnected";
              const badgeVariant =
                ch.status === "error" ? "error"
                : ch.status === "connected" && ch.configured && ch.enabled !== false ? "success"
                : "secondary";
              return (
                <button
                  key={ch.type}
                  type="button"
                  onClick={() => onNavigate("setup")}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/30 transition-colors group/row"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                  <p className="text-xs font-medium capitalize flex-1 min-w-0 truncate">
                    {ch.label ?? ch.type}
                  </p>
                  {ch.lastError && (
                    <p className="text-[10px] text-error truncate max-w-[220px] hidden sm:block" title={ch.lastError}>
                      {ch.lastError}
                    </p>
                  )}
                  <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                  <ChevronRight
                    size={12}
                    className="text-muted-foreground group-hover/row:text-foreground transition-colors"
                  />
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Recent activity from logs */}
      <RecentActivity onNavigate={onNavigate} />

      {/* Keyboard shortcut hint */}
      <p className="text-[10px] text-muted-foreground text-center">
        Tip: use <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px] font-mono">⌘/Ctrl</kbd>
        {" "}+{" "}
        <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px] font-mono">1-6</kbd> to switch tabs.
      </p>
    </motion.div>
  );
}
