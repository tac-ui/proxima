"use client";

import React, { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import { api } from "@/lib/api";
import { Card, CardHeader, CardContent, Button, Badge, Input, SensitiveInput, Select, Skeleton, Tabs, TabsList, TabTrigger, TabContent, pageEntrance, useToast } from "@tac-ui/web";
import { BrainCircuit, MessageSquare, Wifi, Cpu, Shield, FileText, Settings, RotateCw, Power, ScrollText, RefreshCw, KeyRound, GitBranch } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { SessionList } from "@/components/openclaw/SessionList";
import { ChannelSetup } from "@/components/openclaw/ChannelSetup";
import { ModelManager } from "@/components/openclaw/ModelManager";
import { ModelSelector } from "@/components/openclaw/ModelSelector";
import { ConfigEditor } from "@/components/openclaw/ConfigEditor";
import { FileManager } from "@/components/openclaw/FileManager";
import { TokenProviderManager } from "@/components/openclaw/TokenProviderManager";
import { Dashboard } from "@/components/openclaw/Dashboard";
import { LogViewer } from "@/components/openclaw/LogViewer";
import { GitSshKeyCard } from "@/components/openclaw/GitSshKeyCard";
import { GitIdentityCard } from "@/components/openclaw/GitIdentityCard";

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);

  const handleProviderChange = (value: string) => {
    setProvider(value);
    setApiKey("");
  };

  const PROVIDERS = [
    { value: "anthropic", label: "Anthropic (Claude)" },
    { value: "openai", label: "OpenAI (GPT)" },
    { value: "google", label: "Google (Gemini)" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "moonshot", label: "Moonshot (Kimi)" },
    { value: "zai", label: "ZAI (GLM)" },
    { value: "ollama", label: "Ollama (Local)" },
  ];

  const KEY_MAP: Record<string, { field: string; placeholder: string; isUrl?: boolean }> = {
    anthropic: { field: "anthropicApiKey", placeholder: "sk-ant-..." },
    openai: { field: "openaiApiKey", placeholder: "sk-..." },
    google: { field: "geminiApiKey", placeholder: "AI..." },
    openrouter: { field: "openrouterApiKey", placeholder: "sk-or-..." },
    moonshot: { field: "moonshotApiKey", placeholder: "sk-..." },
    zai: { field: "zaiApiKey", placeholder: "..." },
    ollama: { field: "ollamaBaseUrl", placeholder: "http://localhost:11434", isUrl: true },
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const models = apiKey.trim()
        ? { [KEY_MAP[provider].field]: apiKey.trim() } as Record<string, string>
        : undefined;
      const res = await api.updateOpenClawSettings({
        enabled: true,
        gatewayPort: 20242,
        ...(models ? { models } : {}),
      });
      if (res.ok) {
        toast("OpenClaw is starting...", { variant: "success" });
        setTimeout(onComplete, 3000);
      } else {
        toast(res.error ?? "Failed to start", { variant: "error" });
        setLoading(false);
      }
    } catch {
      toast("Failed to configure OpenClaw", { variant: "error" });
      setLoading(false);
    }
  };

  return (
    <motion.div className="max-w-screen-md mx-auto space-y-6" {...pageEntrance}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <BrainCircuit size={18} className="text-point" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Get Started with OpenClaw</h2>
              <p className="text-xs text-muted-foreground">Choose a provider and paste your API key to start</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">Provider</label>
              <Select options={PROVIDERS} value={provider} onChange={handleProviderChange} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">{KEY_MAP[provider].isUrl ? "Base URL" : "API Key"}</label>
              {KEY_MAP[provider].isUrl ? (
                <Input
                  value={apiKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                  placeholder={KEY_MAP[provider].placeholder}
                />
              ) : (
                <SensitiveInput
                  value={apiKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                  placeholder={KEY_MAP[provider].placeholder}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={loading} onClick={handleStart}>
                {loading ? "Starting..." : apiKey.trim() ? "Start OpenClaw" : "Start without API Key"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {apiKey.trim() ? "You can add more providers and configure channels later." : "You can add API keys and configure providers later from the dashboard."}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Map a keyboard index (1..6) to the tab it should activate. */
const TAB_ORDER = ["dashboard", "sessions", "setup", "logs", "credentials", "advanced"] as const;

function extractDefaultModelLabel(config: Record<string, unknown> | null): string {
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

/**
 * Split a model ID into a short "provider" label and a tail so the header
 * chip can render "OpenRouter · glm-4.5-air:free" instead of a truncated
 * "openrouter/z-ai/glm-4.5..." with the interesting part cut off.
 */
function splitModelForHeader(modelId: string): { provider: string; tail: string } | null {
  if (!modelId) return null;
  const slash = modelId.indexOf("/");
  if (slash <= 0 || slash === modelId.length - 1) {
    return { provider: "", tail: modelId };
  }
  const provider = modelId.slice(0, slash);
  const rest = modelId.slice(slash + 1);
  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  // For openrouter/<sub-provider>/<model>, collapse to the last segment
  // since the user cares about the actual model name, not the sub-provider.
  const lastSlash = rest.lastIndexOf("/");
  const tail = lastSlash >= 0 ? rest.slice(lastSlash + 1) : rest;
  return { provider: providerLabel, tail };
}

export default function OpenClawPage() {
  const { isManager } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { gateway, enabled, settings, sessions, config, committing, refreshSessions, refreshSettings } = useOpenClaw();
  const [creatingSession, setCreatingSession] = useState(false);
  const [refreshingSessions, setRefreshingSessions] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | null>(null);
  const [tab, setTab] = useState<string>("dashboard");

  // Compact label for the header model chip.
  const headerModel = useMemo(() => extractDefaultModelLabel(config), [config]);

  // Keyboard shortcuts — ⌘/Ctrl + 1..6 for tab switching. Skipped when an
  // input/textarea is focused so users editing fields don't trigger a jump.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable) return;
      const index = parseInt(e.key, 10);
      if (!Number.isFinite(index) || index < 1 || index > TAB_ORDER.length) return;
      const nextTab = TAB_ORDER[index - 1];
      if (!nextTab) return;
      // Skip manager-only tabs for non-managers
      if (!isManager && (nextTab === "logs" || nextTab === "credentials" || nextTab === "advanced")) return;
      e.preventDefault();
      setTab(nextTab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isManager]);

  if (!enabled) {
    return <Onboarding onComplete={() => { refreshSettings(); }} />;
  }

  const handleCreateSession = async () => {
    if (!gateway.connected) return;
    setCreatingSession(true);
    try {
      await gateway.request("sessions.create", {});
      await refreshSessions();
      toast("Session created", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create session", { variant: "error" });
    }
    setCreatingSession(false);
  };

  const handleRefreshSessions = async () => {
    if (!gateway.connected) return;
    setRefreshingSessions(true);
    try {
      await refreshSessions();
    } finally {
      setRefreshingSessions(false);
    }
  };

  const handleAction = async (action: "start" | "stop" | "restart") => {
    if (action === "stop" || action === "restart") {
      const ok = await confirm({
        title: action === "stop" ? "Stop OpenClaw" : "Restart OpenClaw",
        message: action === "stop"
          ? "Stop the gateway? Active sessions will be disconnected."
          : "Restart the gateway? Active sessions will be briefly disconnected.",
        confirmLabel: action === "stop" ? "Stop" : "Restart",
        variant: "destructive",
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const res = await api.openclawAction(action);
      if (res.ok && res.data?.success) {
        toast(`OpenClaw ${action === "start" ? "started" : action === "stop" ? "stopped" : "restarted"}`, { variant: "success" });
      } else {
        toast(res.data?.error || res.error || `Failed to ${action}`, { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : `Failed to ${action}`, { variant: "error" });
    }
    setBusy(null);
  };

  const handleDeleteSession = async (key: string) => {
    if (!gateway.connected) return;
    const session = sessions.find(s => s.key === key);
    const ok = await confirm({
      title: "Delete Session",
      message: `Delete "${session?.label || key}"? All messages will be permanently removed.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await gateway.request("sessions.delete", { key });
      await refreshSessions();
      toast("Session deleted", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete session", { variant: "error" });
    }
  };

  return (
    <motion.div className="max-w-screen-md mx-auto space-y-6" {...pageEntrance}>
      {/* Page header with single status indicator */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-point/15 flex items-center justify-center">
          <BrainCircuit size={20} className="text-point" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-base font-semibold">OpenClaw</h1>
            {(() => {
              // Unified status resolver. Priority order matches user intent:
              // 1. Explicit actions (user pressed Start/Stop/Restart)
              // 2. Local config commits (gateway restarts after patch)
              // 3. Background reconnect attempts (WS dropped)
              // 4. Steady state (connected / disconnected)
              let label: string;
              let variant: "warning" | "success" | "secondary" | "info";
              let pulse = false;
              if (busy === "restart") { label = "Restarting"; variant = "warning"; pulse = true; }
              else if (busy === "start") { label = "Starting"; variant = "warning"; pulse = true; }
              else if (busy === "stop") { label = "Stopping"; variant = "warning"; pulse = true; }
              else if (committing) { label = "Reloading config"; variant = "warning"; pulse = true; }
              else if (gateway.reconnecting) { label = "Reconnecting"; variant = "warning"; pulse = true; }
              else if (gateway.connected) { label = "Connected"; variant = "success"; }
              else { label = "Disconnected"; variant = "secondary"; }
              const dotClass =
                variant === "success" ? "bg-success"
                : variant === "warning" ? `bg-warning${pulse ? " animate-pulse" : ""}`
                : "bg-muted-foreground/50";
              return (
                <Badge variant={variant}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
                    {label}
                  </span>
                </Badge>
              );
            })()}
            {headerModel && (() => {
              const parts = splitModelForHeader(headerModel);
              return (
                <button
                  type="button"
                  onClick={() => setTab("setup")}
                  title={`${headerModel} — click to change model`}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border bg-muted/40 hover:border-foreground/30 hover:bg-muted/60 transition-colors text-[10px] text-muted-foreground max-w-[220px]"
                >
                  <Cpu size={10} className="shrink-0" />
                  {parts && parts.provider ? (
                    <span className="flex items-center gap-1 min-w-0">
                      <span className="shrink-0 font-medium text-foreground">{parts.provider}</span>
                      <span className="shrink-0 text-muted-foreground/60">·</span>
                      <span className="font-mono truncate">{parts.tail}</span>
                    </span>
                  ) : (
                    <span className="font-mono truncate">{headerModel}</span>
                  )}
                </button>
              );
            })()}
          </div>
          <p className="text-xs text-muted-foreground">AI Assistant Gateway</p>
        </div>
        {isManager && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => handleAction("restart")}
              title="Restart gateway"
            >
              <RotateCw size={14} className={busy === "restart" ? "animate-spin" : ""} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => handleAction(gateway.connected ? "stop" : "start")}
              title={gateway.connected ? "Stop gateway" : "Start gateway"}
            >
              <Power size={14} className={gateway.connected ? "text-error" : "text-success"} />
            </Button>
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabTrigger value="dashboard">Dashboard</TabTrigger>
          <TabTrigger value="sessions">Sessions</TabTrigger>
          <TabTrigger value="setup">Setup</TabTrigger>
          {isManager && <TabTrigger value="logs">Logs</TabTrigger>}
          {isManager && <TabTrigger value="credentials">Credentials</TabTrigger>}
          {isManager && <TabTrigger value="advanced">Advanced</TabTrigger>}
        </TabsList>

        {/* Dashboard Tab */}
        <TabContent value="dashboard">
          <div className="pt-4">
            <Dashboard onNavigate={setTab} />
          </div>
        </TabContent>

        {/* Sessions Tab */}
        <TabContent value="sessions">
          <div className="pt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
                    <MessageSquare size={18} className="text-point" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Chat Sessions</h2>
                    <p className="text-xs text-muted-foreground">Start conversations with your AI assistant</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <SessionList
                  sessions={sessions}
                  onCreateSession={handleCreateSession}
                  onDeleteSession={handleDeleteSession}
                  onRefresh={handleRefreshSessions}
                  creating={creatingSession}
                  refreshing={refreshingSessions}
                  connected={gateway.connected}
                />
              </CardContent>
            </Card>
          </div>
        </TabContent>

        {/* Setup Tab */}
        <TabContent value="setup">
          <div className="pt-4 space-y-6">
            {/* Reconnecting / disconnected banner. While the gateway is
                offline we replace the Model / Channels card bodies with
                skeletons — stale data with disabled inputs gave the
                impression that fields were empty, so showing an honest
                "loading" state is less confusing. */}
            {(!gateway.connected || gateway.reconnecting) && (
              <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 flex items-start gap-2">
                <RefreshCw size={14} className="text-warning shrink-0 mt-0.5 animate-spin" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">
                    {gateway.reconnecting ? "Reconnecting to gateway…" : "Gateway disconnected"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Setup will load once the connection is restored.
                  </p>
                </div>
              </div>
            )}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
                    <Cpu size={18} className="text-warning" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Model</h2>
                    <p className="text-xs text-muted-foreground">Default AI model for conversations</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {gateway.connected && !gateway.reconnecting ? (
                  <ModelSelector />
                ) : (
                  <div className="space-y-3">
                    <Skeleton height={20} width="40%" />
                    <Skeleton height={72} />
                    <Skeleton height={36} width="60%" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
                    <Wifi size={18} className="text-success" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">Channels</h2>
                    <p className="text-xs text-muted-foreground">Connect messaging platforms</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {gateway.connected && !gateway.reconnecting ? (
                  <ChannelSetup />
                ) : (
                  <div className="space-y-3">
                    <Skeleton height={20} width="30%" />
                    <Skeleton height={48} />
                    <Skeleton height={48} />
                    <Skeleton height={36} width="50%" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabContent>

        {/* Logs Tab */}
        {isManager && (
          <TabContent value="logs">
            <div className="pt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
                      <ScrollText size={18} className="text-info" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Activity Logs</h2>
                      <p className="text-xs text-muted-foreground">Messages, responses, and gateway events</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <LogViewer />
                </CardContent>
              </Card>
            </div>
          </TabContent>
        )}

        {/* Credentials Tab */}
        {isManager && (
          <TabContent value="credentials">
            <div className="pt-4 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
                      <BrainCircuit size={18} className="text-point" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">API Keys</h2>
                      <p className="text-xs text-muted-foreground">Standard model provider credentials</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ModelManager settings={settings} onSaved={refreshSettings} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
                      <Shield size={18} className="text-info" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Token Providers</h2>
                      <p className="text-xs text-muted-foreground">Custom OAuth tokens and provider auth profiles</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <TokenProviderManager />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
                      <KeyRound size={18} className="text-warning" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Git SSH Key</h2>
                      <p className="text-xs text-muted-foreground">SSH key the agent uses for git clone / pull</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <GitSshKeyCard />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
                      <GitBranch size={18} className="text-success" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Git Identity & GitHub Token</h2>
                      <p className="text-xs text-muted-foreground">Commit author + PAT for <code className="font-mono">gh pr create</code></p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <GitIdentityCard />
                </CardContent>
              </Card>
            </div>
          </TabContent>
        )}

        {/* Advanced Tab */}
        {isManager && (
          <TabContent value="advanced">
            <div className="pt-4 space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                      <FileText size={18} className="text-muted-foreground" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Harness Files</h2>
                      <p className="text-xs text-muted-foreground">USER.md, CLAUDE.md and other configuration files</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <FileManager />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                      <Settings size={18} className="text-muted-foreground" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Raw Config</h2>
                      <p className="text-xs text-muted-foreground">Full OpenClaw JSON configuration</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ConfigEditor />
                </CardContent>
              </Card>
            </div>
          </TabContent>
        )}
      </Tabs>
    </motion.div>
  );
}
