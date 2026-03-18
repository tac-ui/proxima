"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiContext } from "@/contexts/ApiContext";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toHttpsUrl } from "@/lib/url-utils";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Button,
  Input,
  Tabs,
  TabsList,
  TabTrigger,
  TabContent,
  Skeleton,
  useToast,
} from "@tac-ui/web";
import {
  Github,
  Trash2,
  X,
  Play,
  Plus,
  Square,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  Save,
  FileCode2,
  GitBranch,
  ExternalLink,
  Eye,
  EyeOff,
  Copy,
  Webhook,
} from "@tac-ui/icon";
import { CopyButton } from "@/components/shared/CopyButton";
import dynamic from "next/dynamic";
import { useConfirm } from "@/hooks/useConfirm";
import type { RepositoryInfo, RepoEnvFile, WebhookLog } from "@/types";

const ScriptLogViewer = dynamic(
  () => import("@/components/terminal/ScriptLogViewer").then((m) => m.ScriptLogViewer),
  { ssr: false },
);

function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const repoId = parseInt(params.id as string, 10);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { connected, subscribe } = useApiContext();
  const { isManager } = useAuth();

  const [repo, setRepo] = useState<RepositoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("scripts");

  // Script management
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptCommand, setNewScriptCommand] = useState("");
  const [newScriptPreCommand, setNewScriptPreCommand] = useState("");
  const [showAddScript, setShowAddScript] = useState(false);

  // Running terminals
  const [runningTerminals, setRunningTerminals] = useState<Record<string, string>>({});
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(new Set());
  const restoredRef = useRef(false);
  const [pendingRestart, setPendingRestart] = useState<Record<string, number>>({});

  // Script exit codes and output
  const [exitCodes, setExitCodes] = useState<Record<string, number>>({});
  const [scriptOutputs, setScriptOutputs] = useState<Record<string, string>>({});

  // Pull state
  const [pulling, setPulling] = useState(false);

  // Env editor
  const [envSelectedFile, setEnvSelectedFile] = useState<string>("");
  const [envContent, setEnvContent] = useState<Record<string, string>>({});
  const [envLoaded, setEnvLoaded] = useState<Set<string>>(new Set());
  const [envSaving, setEnvSaving] = useState<Set<string>>(new Set());
  const [showAddEnvFile, setShowAddEnvFile] = useState(false);
  const [newEnvFileName, setNewEnvFileName] = useState("");
  const [newEnvFilePath, setNewEnvFilePath] = useState("");

  // Branch switching
  const [branchList, setBranchList] = useState<string[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  // Script suggestions
  const [suggestions, setSuggestions] = useState<{ name: string; command: string; preCommand?: string }[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);

  // Git commits
  const [commits, setCommits] = useState<{ hash: string; shortHash: string; message: string; author: string; date: string }[]>([]);

  // Webhook state
  const [hookEnabled, setHookEnabled] = useState(false);
  const [hookApiKey, setHookApiKey] = useState<string | null>(null);
  const [hookKeyVisible, setHookKeyVisible] = useState(false);
  const [hookKeyInput, setHookKeyInput] = useState("");
  const [hookSaving, setHookSaving] = useState(false);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [webhookLogsTotal, setWebhookLogsTotal] = useState(0);
  const [webhookLogsPage, setWebhookLogsPage] = useState(1);
  const [webhookLogsLoading, setWebhookLogsLoading] = useState(false);

  // --- Data fetching ---

  const fetchRepo = useCallback(() => {
    api.getRepo(repoId).then((res) => {
      if (res.ok && res.data) {
        setRepo(res.data);
        setHookEnabled(res.data.hookEnabled);
        setHookApiKey(res.data.hookApiKey);
      } else {
        toast(res.error ?? "Failed to load project", { variant: "error" });
      }
      setLoading(false);
    });
  }, [repoId, toast]);

  const fetchCommits = useCallback(() => {
    api.getRepoCommits(repoId, 20).then((res) => {
      if (res.ok && res.data) setCommits(res.data.commits);
    });
  }, [repoId]);

  const fetchWebhookLogs = useCallback((page: number = 1) => {
    setWebhookLogsLoading(true);
    api.getWebhookLogs(repoId, page).then((res) => {
      if (res.ok && res.data) {
        setWebhookLogs(res.data.logs);
        setWebhookLogsTotal(res.data.total);
      }
      setWebhookLogsLoading(false);
    });
  }, [repoId]);

  useEffect(() => {
    if (connected) {
      fetchRepo();
      fetchCommits();
    }
  }, [connected, fetchRepo, fetchCommits]);

  // Restore active terminals
  useEffect(() => {
    if (!repo || restoredRef.current) return;
    restoredRef.current = true;
    api.getActiveTerminals().then((res) => {
      if (!res.ok || !res.data || res.data.length === 0) return;
      const restored: Record<string, string> = {};
      const prefix = `repo-${repo.name}-s`;
      for (const t of res.data) {
        if (t.id.startsWith(prefix)) {
          const rest = t.id.slice(prefix.length);
          const dashIdx = rest.indexOf("-");
          const scriptIdx = dashIdx >= 0 ? parseInt(rest.slice(0, dashIdx), 10) : NaN;
          if (!isNaN(scriptIdx) && scriptIdx >= 0 && scriptIdx < repo.scripts.length) {
            restored[`${scriptIdx}`] = t.id;
          }
        }
      }
      if (Object.keys(restored).length > 0) {
        setRunningTerminals((prev) => ({ ...prev, ...restored }));
        setExpandedTerminals((prev) => {
          const next = new Set(prev);
          for (const key of Object.keys(restored)) next.add(key);
          return next;
        });
      }
    });
  }, [repo]);

  // Load webhook logs when tab switches to webhook
  useEffect(() => {
    if (activeTab === "webhook") {
      fetchWebhookLogs(1);
      setWebhookLogsPage(1);
    }
  }, [activeTab, fetchWebhookLogs]);

  // Running count
  const runningCount = useMemo(
    () => Object.keys(runningTerminals).length,
    [runningTerminals],
  );

  // --- Handlers ---

  const handlePull = async () => {
    setPulling(true);
    const res = await api.pullRepo(repoId);
    setPulling(false);
    if (res.ok && res.data) {
      const isUpToDate = res.data.message.includes("Already up to date");
      toast(res.data.message, { variant: "success" });
      if (!isUpToDate) {
        fetchCommits();
        fetchRepo();
        const runningKeys = Object.keys(runningTerminals);
        if (runningKeys.length > 0) {
          const shouldRestart = await confirm({
            title: "Restart running scripts?",
            message: `Code was updated. ${runningKeys.length} script${runningKeys.length > 1 ? "s are" : " is"} running. Restart to apply changes?`,
            confirmLabel: "Restart All",
          });
          if (shouldRestart) {
            for (const key of runningKeys) {
              const scriptIndex = parseInt(key, 10);
              if (!isNaN(scriptIndex)) handleRestartScript(scriptIndex);
            }
          }
        }
      }
    } else {
      toast(res.error ?? "Pull failed", { variant: "error" });
    }
  };

  const handleDelete = async () => {
    if (!repo) return;
    const ok = await confirm({
      title: "Delete Project",
      message: `Are you sure you want to delete "${repo.name}"? This only removes it from Proxima — the files on disk are not deleted.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const res = await api.deleteRepo(repoId);
    if (res.ok) {
      toast("Project deleted", { variant: "success" });
      router.push("/projects");
    }
  };

  const handleAddScript = () => {
    if (!newScriptName.trim() || !newScriptCommand.trim()) return;
    const pre = newScriptPreCommand.trim() || undefined;
    api.addRepoScript(repoId, newScriptName.trim(), newScriptCommand.trim(), pre).then((res) => {
      if (res.ok) {
        fetchRepo();
        setShowAddScript(false);
        setNewScriptName("");
        setNewScriptCommand("");
        setNewScriptPreCommand("");
      }
    });
  };

  const handleRunScript = (scriptIndex: number) => {
    const scriptKey = `${scriptIndex}`;
    setExitCodes((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
    setScriptOutputs((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
    api.runRepoScript(repoId, scriptIndex).then((res) => {
      if (res.ok && res.data) {
        setRunningTerminals((prev) => ({ ...prev, [scriptKey]: res.data!.terminalId }));
        setExpandedTerminals((prev) => new Set(prev).add(scriptKey));
      }
    });
  };

  const handleStopScript = (scriptKey: string) => {
    const terminalId = runningTerminals[scriptKey];
    if (terminalId) api.killTerminal(terminalId);
  };

  const handleRestartScript = (scriptIndex: number) => {
    const scriptKey = `${scriptIndex}`;
    const terminalId = runningTerminals[scriptKey];
    if (!terminalId) return;
    setPendingRestart((prev) => ({ ...prev, [scriptKey]: scriptIndex }));
    api.killTerminal(terminalId);
  };

  const handleTerminalExit = (scriptKey: string, exitCode?: number, output?: string) => {
    setRunningTerminals((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
    if (exitCode !== undefined) setExitCodes((prev) => ({ ...prev, [scriptKey]: exitCode }));
    if (output !== undefined) setScriptOutputs((prev) => ({ ...prev, [scriptKey]: output }));
    const restart = pendingRestart[scriptKey];
    if (restart !== undefined) {
      setPendingRestart((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
      setTimeout(() => handleRunScript(restart), 300);
    }
  };

  const toggleTerminal = (scriptKey: string) => {
    setExpandedTerminals((prev) => {
      const next = new Set(prev);
      if (next.has(scriptKey)) next.delete(scriptKey); else next.add(scriptKey);
      return next;
    });
  };

  // Env handlers
  const getEnvFiles = (r: RepositoryInfo): RepoEnvFile[] => {
    if (r.envFiles && r.envFiles.length > 0) return r.envFiles;
    return [{ name: ".env", path: ".env" }];
  };

  const loadEnvContent = async (filePath: string) => {
    if (envLoaded.has(filePath)) return;
    const res = await api.getRepoEnv(repoId, filePath);
    if (res.ok && res.data) {
      setEnvContent((prev) => ({ ...prev, [filePath]: res.data!.content }));
      setEnvLoaded((prev) => new Set(prev).add(filePath));
    }
  };

  // Load first env file when tab switches
  useEffect(() => {
    if (activeTab === "env" && repo) {
      const files = getEnvFiles(repo);
      const selected = envSelectedFile || files[0]?.path || ".env";
      setEnvSelectedFile(selected);
      loadEnvContent(selected);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, repo]);

  const handleSelectEnvFile = async (filePath: string) => {
    setEnvSelectedFile(filePath);
    await loadEnvContent(filePath);
  };

  const handleSaveEnv = async () => {
    const filePath = envSelectedFile || ".env";
    setEnvSaving((prev) => new Set(prev).add(filePath));
    const res = await api.updateRepoEnv(repoId, envContent[filePath] ?? "", filePath);
    setEnvSaving((prev) => { const next = new Set(prev); next.delete(filePath); return next; });
    if (res.ok) toast(`${filePath} saved`, { variant: "success" });
    else toast(res.error ?? `Failed to save ${filePath}`, { variant: "error" });
  };

  const handleAddEnvFile = async () => {
    if (!newEnvFileName.trim() || !newEnvFilePath.trim()) return;
    const res = await api.addRepoEnvFile(repoId, newEnvFileName.trim(), newEnvFilePath.trim());
    if (res.ok) {
      fetchRepo();
      setShowAddEnvFile(false);
      setNewEnvFileName("");
      setNewEnvFilePath("");
      setEnvSelectedFile(newEnvFilePath.trim());
      toast("Env file added", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to add env file", { variant: "error" });
    }
  };

  const handleRemoveEnvFile = async (filePath: string) => {
    const ok2 = await confirm({
      title: "Remove env file",
      message: `Remove "${filePath}" from the list? The file on disk won't be deleted.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok2) return;
    const res = await api.removeRepoEnvFile(repoId, filePath);
    if (res.ok) {
      fetchRepo();
      if (envSelectedFile === filePath) setEnvSelectedFile("");
      toast("Env file removed", { variant: "success" });
    }
  };

  // Branch handlers
  const toggleBranches = async () => {
    if (branchOpen) { setBranchOpen(false); return; }
    setBranchLoading(true);
    const res = await api.getRepoBranches(repoId);
    setBranchLoading(false);
    if (res.ok && res.data) setBranchList(res.data.branches);
    setBranchOpen(true);
  };

  const handleCheckout = async (branch: string) => {
    setCheckingOut(true);
    const res = await api.checkoutBranch(repoId, branch);
    setCheckingOut(false);
    if (res.ok && res.data) {
      toast(res.data.message, { variant: "success" });
      fetchRepo();
      setBranchOpen(false);
      const runningKeys = Object.keys(runningTerminals);
      if (runningKeys.length > 0) {
        const shouldRestart = await confirm({
          title: "Restart running scripts?",
          message: `Branch changed to ${branch}. Restart running scripts?`,
          confirmLabel: "Restart All",
        });
        if (shouldRestart) {
          for (const key of runningKeys) {
            const scriptIndex = parseInt(key, 10);
            if (!isNaN(scriptIndex)) handleRestartScript(scriptIndex);
          }
        }
      }
    } else {
      toast(res.error ?? "Checkout failed", { variant: "error" });
    }
  };

  // Suggestions
  const loadSuggestions = async () => {
    if (suggestionsLoaded) return;
    const res = await api.getSuggestedScripts(repoId);
    if (res.ok && res.data) {
      setSuggestions(res.data.suggestions);
      setSuggestionsLoaded(true);
    }
  };

  useEffect(() => {
    if (showAddScript && !suggestionsLoaded) loadSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddScript]);

  const handleAddSuggestedScript = (name: string, command: string, preCommand?: string) => {
    api.addRepoScript(repoId, name, command, preCommand).then((res) => {
      if (res.ok) {
        fetchRepo();
        setSuggestions((prev) => prev.filter((s) => !(s.name === name && s.command === command)));
      }
    });
  };

  // Webhook handlers
  const handleToggleWebhook = async (enabled: boolean) => {
    setHookSaving(true);
    const res = await api.updateWebhookConfig(repoId, { enabled });
    setHookSaving(false);
    if (res.ok && res.data) {
      setHookEnabled(res.data.hookEnabled);
      setHookApiKey(res.data.hookApiKey);
      toast(enabled ? "Webhook enabled" : "Webhook disabled", { variant: "success" });
    } else {
      toast("Failed to update webhook", { variant: "error" });
    }
  };

  const handleSaveApiKey = async () => {
    setHookSaving(true);
    const res = await api.updateWebhookConfig(repoId, {
      enabled: hookEnabled,
      apiKey: hookKeyInput.trim() || undefined,
    });
    setHookSaving(false);
    if (res.ok && res.data) {
      setHookApiKey(res.data.hookApiKey);
      setHookKeyInput("");
      toast("API key updated", { variant: "success" });
    } else {
      toast("Failed to update API key", { variant: "error" });
    }
  };

  const handleGenerateApiKey = async () => {
    setHookSaving(true);
    const newKey = crypto.randomUUID();
    const res = await api.updateWebhookConfig(repoId, { enabled: hookEnabled, apiKey: newKey });
    setHookSaving(false);
    if (res.ok && res.data) {
      setHookApiKey(res.data.hookApiKey);
      setHookKeyVisible(true);
      toast("API key generated", { variant: "success" });
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton height={60} />
        <Skeleton height={400} />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="py-12 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Project not found</p>
        <Button size="sm" variant="secondary" onClick={() => router.push("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const githubUrl = repo.repoUrl.includes("github.com") ? toHttpsUrl(repo.repoUrl) : null;
  const envFiles = getEnvFiles(repo);
  const selectedEnvPath = envSelectedFile || envFiles[0]?.path || ".env";

  const webhookTotalPages = Math.ceil(webhookLogsTotal / 20);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button size="sm" variant="ghost" iconOnly onClick={() => router.push("/projects")} aria-label="Back">
            <ChevronLeft size={16} />
          </Button>
          <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center shrink-0 relative">
            <Github size={18} className="text-point" />
            {runningCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-success text-[9px] text-white flex items-center justify-center font-bold">
                {runningCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold truncate">{repo.name}</h1>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-point transition-colors shrink-0"
                onClick={toggleBranches}
                disabled={branchLoading}
              >
                <GitBranch size={10} />
                {repo.branch}
                {branchLoading ? <RefreshCw size={8} className="animate-spin" /> : <ChevronDown size={8} />}
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-mono truncate max-w-[400px]">{repo.repoUrl}</span>
              <CopyButton value={repo.repoUrl} label="repo URL" />
            </div>
          </div>
        </div>
        {isManager && (
          <div className="flex gap-1 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              onClick={handlePull}
              disabled={pulling}
              leftIcon={<RefreshCw size={12} className={pulling ? "animate-spin" : ""} />}
            >
              {pulling ? "Pulling..." : "Pull"}
            </Button>
            <Button size="sm" variant="ghost" iconOnly onClick={handleDelete} title="Delete Project" aria-label="Delete Project">
              <Trash2 size={14} />
            </Button>
            {githubUrl && (
              <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="ghost" iconOnly title="Open on GitHub" aria-label="Open on GitHub">
                  <ExternalLink size={14} />
                </Button>
              </a>
            )}
          </div>
        )}
      </div>

      {/* Branch switcher */}
      {branchOpen && branchList.length > 0 && (
        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border bg-surface">
          {branchList.map((b) => (
            <button
              key={b}
              disabled={checkingOut}
              onClick={() => handleCheckout(b)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                b === repo.branch
                  ? "bg-point/15 text-point font-semibold"
                  : "hover:bg-surface-hover text-muted-foreground hover:text-foreground"
              }`}
            >
              {b}
            </button>
          ))}
          {checkingOut && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw size={10} className="animate-spin" /> Switching...
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabTrigger value="scripts">Scripts</TabTrigger>
          <TabTrigger value="env">Environment</TabTrigger>
          <TabTrigger value="webhook">Webhook</TabTrigger>
          <TabTrigger value="git">Git</TabTrigger>
        </TabsList>

        {/* Scripts Tab */}
        <TabContent value="scripts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Scripts</p>
                {isManager && !showAddScript && (
                  <Button size="sm" variant="secondary" onClick={() => setShowAddScript(true)} leftIcon={<Plus size={12} />}>
                    Add Script
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {repo.scripts.length === 0 && !showAddScript && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No scripts configured</p>
                )}

                {repo.scripts.map((script, idx) => {
                  const scriptKey = `${idx}`;
                  const terminalId = runningTerminals[scriptKey];
                  const isRunning = !!terminalId;
                  const isExpanded = expandedTerminals.has(scriptKey);
                  const isRestarting = !!pendingRestart[scriptKey];
                  const lastExitCode = exitCodes[scriptKey];
                  const hasFailed = lastExitCode !== undefined && lastExitCode !== 0;

                  return (
                    <div key={idx} className="space-y-2">
                      <div className={`flex items-center justify-between gap-2 p-2 rounded-lg bg-surface border ${isRunning ? "border-success/30" : hasFailed ? "border-destructive/30" : "border-border"}`}>
                        <div className="min-w-0 flex items-center gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{script.name}</p>
                            {script.preCommand && (
                              <p className="text-[10px] text-muted-foreground/60 font-mono truncate">pre: {script.preCommand}</p>
                            )}
                            <p className="text-xs text-muted-foreground font-mono truncate">{script.command}</p>
                          </div>
                          {isRunning && <Badge variant="success">{isRestarting ? "Restarting" : "Running"}</Badge>}
                          {!isRunning && lastExitCode !== undefined && (
                            <Badge variant={hasFailed ? "destructive" : "success"}>
                              {hasFailed ? `Exit ${lastExitCode}` : "Done"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {isRunning ? (
                            <>
                              <Button size="sm" variant="ghost" iconOnly onClick={() => toggleTerminal(scriptKey)} title="Toggle Terminal Output" aria-label="Toggle Terminal Output">
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </Button>
                              <Button size="sm" variant="secondary" iconOnly onClick={() => handleRestartScript(idx)} disabled={isRestarting} title="Restart" aria-label="Restart">
                                <RotateCcw size={12} />
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleStopScript(scriptKey)} leftIcon={<Square size={12} />}>
                                Stop
                              </Button>
                            </>
                          ) : isManager ? (
                            <Button size="sm" onClick={() => handleRunScript(idx)} leftIcon={<Play size={12} />}>
                              Run
                            </Button>
                          ) : null}
                          {!isRunning && isManager && (
                            <Button size="sm" variant="ghost" iconOnly onClick={() => { api.removeRepoScript(repoId, idx).then((res) => { if (res.ok) fetchRepo(); }); }} title="Delete script" aria-label="Delete script">
                              <X size={12} />
                            </Button>
                          )}
                        </div>
                      </div>
                      {isRunning && isExpanded && (
                        <ScriptLogViewer
                          terminalId={terminalId}
                          title={script.name}
                          onExit={(code: number, output: string) => handleTerminalExit(scriptKey, code, output)}
                        />
                      )}
                      {!isRunning && scriptOutputs[scriptKey] && (
                        <ScriptLogViewer
                          terminalId=""
                          title={script.name}
                          staticOutput={scriptOutputs[scriptKey]}
                          exitCode={exitCodes[scriptKey]}
                        />
                      )}
                    </div>
                  );
                })}

                {showAddScript && (
                  <div className="space-y-2 border-t border-border pt-3">
                    {/* Suggestions */}
                    {(() => {
                      const filtered = suggestions.filter(
                        (s) => !repo.scripts.some((existing) => existing.name === s.name || existing.command === s.command),
                      );
                      if (filtered.length === 0) return null;
                      return (
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Detected scripts</p>
                          <div className="flex flex-wrap gap-1.5">
                            {filtered.map((s) => (
                              <button
                                key={`${s.name}-${s.command}`}
                                onClick={() => handleAddSuggestedScript(s.name, s.command, s.preCommand)}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border bg-surface hover:border-point/30 hover:bg-point/5 transition-colors text-xs"
                                title={s.command}
                              >
                                <Plus size={10} className="text-point" />
                                <span className="font-medium">{s.name}</span>
                                <span className="text-muted-foreground font-mono text-[10px] max-w-[120px] truncate">{s.command}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Input placeholder="Script name" value={newScriptName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScriptName(e.target.value)} className="flex-1 h-8" />
                        <Input
                          placeholder="Command (e.g. npm run dev)"
                          value={newScriptCommand}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScriptCommand(e.target.value)}
                          className="flex-1 h-8"
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAddScript(); if (e.key === "Escape") setShowAddScript(false); }}
                        />
                      </div>
                      <div className="flex gap-2 items-center">
                        <Input
                          placeholder="Pre-command (optional, e.g. npm install)"
                          value={newScriptPreCommand}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScriptPreCommand(e.target.value)}
                          className="flex-1 h-8"
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAddScript(); if (e.key === "Escape") setShowAddScript(false); }}
                        />
                        <Button size="sm" onClick={handleAddScript}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowAddScript(false)}>Cancel</Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabContent>

        {/* Environment Tab */}
        <TabContent value="env">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 size={14} />
                  <p className="text-sm font-semibold">Environment Variables</p>
                  {envFiles.length > 1 && (
                    <span className="text-[10px] text-muted-foreground">{envFiles.length} files</span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* File selector */}
                <div className="flex items-center gap-1 flex-wrap">
                  {envFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => handleSelectEnvFile(f.path)}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                        selectedEnvPath === f.path
                          ? "bg-point/15 text-point font-semibold"
                          : "hover:bg-surface-hover text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f.name}
                    </button>
                  ))}
                  {isManager && (
                    <button
                      onClick={() => setShowAddEnvFile(!showAddEnvFile)}
                      className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-point hover:bg-point/5 transition-colors"
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>

                {showAddEnvFile && (
                  <div className="flex gap-2 items-end">
                    <Input placeholder="Display name" value={newEnvFileName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEnvFileName(e.target.value)} className="flex-1 h-8" />
                    <Input placeholder="Path (e.g. backend/.env)" value={newEnvFilePath} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEnvFilePath(e.target.value)} className="flex-1 h-8" />
                    <Button size="sm" onClick={handleAddEnvFile}>Add</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowAddEnvFile(false); setNewEnvFileName(""); setNewEnvFilePath(""); }}>
                      <X size={12} />
                    </Button>
                  </div>
                )}

                <textarea
                  className="w-full min-h-[200px] p-3 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-point/50"
                  placeholder={"# Add environment variables here\nPORT=3000\nDATABASE_URL=..."}
                  value={envContent[selectedEnvPath] ?? ""}
                  onChange={(e) => setEnvContent((prev) => ({ ...prev, [selectedEnvPath]: e.target.value }))}
                />
                {isManager && (
                  <div className="flex items-center justify-between">
                    <div>
                      {selectedEnvPath !== ".env" && (
                        <Button size="sm" variant="ghost" onClick={() => handleRemoveEnvFile(selectedEnvPath)}>
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                    <Button size="sm" onClick={handleSaveEnv} disabled={envSaving.has(selectedEnvPath)} leftIcon={<Save size={12} />}>
                      {envSaving.has(selectedEnvPath) ? "Saving..." : `Save ${selectedEnvPath}`}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabContent>

        {/* Webhook Tab */}
        <TabContent value="webhook">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Webhook size={14} />
                  <p className="text-sm font-semibold">Webhook</p>
                </div>
                {isManager && (
                  <Button
                    size="sm"
                    variant={hookEnabled ? "destructive" : "primary"}
                    onClick={() => handleToggleWebhook(!hookEnabled)}
                    disabled={hookSaving}
                  >
                    {hookEnabled ? "Disable" : "Enable"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Status */}
                <div className="flex items-center gap-2">
                  <Badge variant={hookEnabled ? "success" : "secondary"}>
                    {hookEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>

                {/* API Key */}
                {hookEnabled && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">API Key</p>
                      {hookApiKey ? (
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-xs font-mono truncate">
                            {hookKeyVisible ? hookApiKey : "••••••••••••••••••••••••"}
                          </code>
                          <Button size="sm" variant="ghost" iconOnly onClick={() => setHookKeyVisible(!hookKeyVisible)} title={hookKeyVisible ? "Hide" : "Show"}>
                            {hookKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </Button>
                          <CopyButton value={hookApiKey} label="API key" />
                          {isManager && (
                            <Button size="sm" variant="secondary" onClick={handleGenerateApiKey} disabled={hookSaving}>
                              Regenerate
                            </Button>
                          )}
                        </div>
                      ) : isManager ? (
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder="Enter API key or generate one"
                            value={hookKeyInput}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHookKeyInput(e.target.value)}
                            className="flex-1 h-8"
                          />
                          <Button size="sm" onClick={handleSaveApiKey} disabled={hookSaving}>
                            Save
                          </Button>
                          <Button size="sm" variant="secondary" onClick={handleGenerateApiKey} disabled={hookSaving}>
                            Generate
                          </Button>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">No API key configured</p>
                      )}
                    </div>

                    {/* Usage example */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Usage</p>
                      <div className="p-3 rounded-lg border border-border bg-surface space-y-1">
                        <p className="text-[11px] text-muted-foreground">Trigger a script via HTTP:</p>
                        <code className="block text-xs font-mono text-foreground break-all">
                          {`curl -X POST -H "x-api-key: <YOUR_KEY>" ${typeof window !== "undefined" ? window.location.origin : ""}/api/hook/${repo.name}/<script_name>`}
                        </code>
                      </div>
                    </div>

                    {/* Webhook Logs */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Logs</p>
                        <Button size="sm" variant="ghost" iconOnly onClick={() => fetchWebhookLogs(webhookLogsPage)} title="Refresh" aria-label="Refresh">
                          <RefreshCw size={12} className={webhookLogsLoading ? "animate-spin" : ""} />
                        </Button>
                      </div>
                      {webhookLogs.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-4 text-center">No webhook executions yet</p>
                      ) : (
                        <>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border text-muted-foreground">
                                  <th className="text-left py-1.5 px-2 font-medium">Time</th>
                                  <th className="text-left py-1.5 px-2 font-medium">Script</th>
                                  <th className="text-left py-1.5 px-2 font-medium">Status</th>
                                  <th className="text-right py-1.5 px-2 font-medium">Duration</th>
                                  <th className="text-left py-1.5 px-2 font-medium">IP</th>
                                  <th className="text-right py-1.5 px-2 font-medium">Exit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {webhookLogs.map((log) => (
                                  <tr key={log.id} className="border-b border-border/50">
                                    <td className="py-1.5 px-2 text-muted-foreground">{formatRelativeDate(log.createdAt)}</td>
                                    <td className="py-1.5 px-2 font-mono">{log.scriptName}</td>
                                    <td className="py-1.5 px-2">
                                      <Badge variant={log.status === "success" ? "success" : log.status === "failed" ? "destructive" : "warning"}>
                                        {log.status}
                                      </Badge>
                                    </td>
                                    <td className="py-1.5 px-2 text-right text-muted-foreground">
                                      {log.duration != null ? `${(log.duration / 1000).toFixed(1)}s` : "-"}
                                    </td>
                                    <td className="py-1.5 px-2 text-muted-foreground font-mono">{log.ipAddress ?? "-"}</td>
                                    <td className="py-1.5 px-2 text-right font-mono">{log.exitCode ?? "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {/* Pagination */}
                          {webhookTotalPages > 1 && (
                            <div className="flex items-center justify-center gap-2 pt-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={webhookLogsPage <= 1}
                                onClick={() => { const p = webhookLogsPage - 1; setWebhookLogsPage(p); fetchWebhookLogs(p); }}
                              >
                                Prev
                              </Button>
                              <span className="text-xs text-muted-foreground">{webhookLogsPage} / {webhookTotalPages}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={webhookLogsPage >= webhookTotalPages}
                                onClick={() => { const p = webhookLogsPage + 1; setWebhookLogsPage(p); fetchWebhookLogs(p); }}
                              >
                                Next
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabContent>

        {/* Git Tab */}
        <TabContent value="git">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch size={14} />
                  <p className="text-sm font-semibold">Git</p>
                </div>
                <Button size="sm" variant="ghost" iconOnly onClick={fetchCommits} title="Refresh" aria-label="Refresh">
                  <RefreshCw size={12} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Repo info */}
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Repository</p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground truncate">{repo.path}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-muted-foreground truncate">{repo.repoUrl}</span>
                    <CopyButton value={repo.repoUrl} label="repo URL" />
                  </div>
                </div>

                {/* Branch */}
                <div className="space-y-1">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Branch</p>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{repo.branch}</Badge>
                    <Button size="sm" variant="ghost" onClick={toggleBranches} disabled={branchLoading}>
                      Switch Branch
                    </Button>
                  </div>
                </div>

                {/* Recent Commits */}
                {commits.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Recent Commits</p>
                    <div className="space-y-1">
                      {commits.map((c) => (
                        <div key={c.hash} className="flex items-baseline gap-2 text-xs">
                          <code className="text-[10px] text-point font-mono shrink-0">{c.shortHash}</code>
                          <span className="truncate">{c.message}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">{c.author} · {formatRelativeDate(c.date)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* GitHub link */}
                {githubUrl && (
                  <div className="pt-2 border-t border-border">
                    <a
                      href={githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink size={10} />
                      Open on GitHub
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabContent>
      </Tabs>
    </div>
  );
}
