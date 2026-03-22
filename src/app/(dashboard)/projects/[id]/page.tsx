"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
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
  pageEntrance,
  Switch,
  Select,
  StatusDot,
} from "@tac-ui/web";
import {
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
  Webhook,
  Power,
} from "@tac-ui/icon";
import { CopyButton } from "@/components/shared/CopyButton";
import dynamic from "next/dynamic";
import { useConfirm } from "@/hooks/useConfirm";
import { Globe } from "@tac-ui/icon";
import type { RepositoryInfo, RepoEnvFile, WebhookLog, DomainConnection, CloudflareZone } from "@/types";

const TerminalView = dynamic(
  () => import("@/components/terminal/Terminal").then((m) => m.Terminal),
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
  const repoParam = decodeURIComponent(params.id as string);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { connected, subscribe } = useApiContext();
  const { isManager } = useAuth();

  const [repo, setRepo] = useState<RepositoryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("scripts");

  // Script management
  const [editingScript, setEditingScript] = useState<{ slug?: string; name: string; content: string; preCommand?: string; command?: string; advancedMode?: boolean } | null>(null);

  // Running terminals
  const [runningTerminals, setRunningTerminals] = useState<Record<string, string>>({});
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(new Set());
  const restoredRef = useRef(false);
  const [pendingRestart, setPendingRestart] = useState<Record<string, number>>({});

  // Script exit codes and output
  const [exitCodes, setExitCodes] = useState<Record<string, number>>({});

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
  const branchDropdownRef = useRef<HTMLDivElement>(null);

  // Script suggestions
  const [suggestions, setSuggestions] = useState<{ name: string; command: string; preCommand?: string }[]>([]);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Git status (dirty check)
  const [repoDirty, setRepoDirty] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Git commits
  const [commits, setCommits] = useState<{ hash: string; shortHash: string; message: string; author: string; date: string }[]>([]);
  const [commitsRefreshing, setCommitsRefreshing] = useState(false);

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

  // Domain connection
  const [domainForm, setDomainForm] = useState({ subdomain: "", port: "3000", useRootDomain: false });
  const [domainSaving, setDomainSaving] = useState(false);
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [selectedZone, setSelectedZone] = useState("");

  // Derive repoId from loaded repo (used for all API calls)
  const repoId = repo?.id ?? 0;

  // --- Data fetching ---

  const fetchRepo = useCallback(() => {
    // Accept both numeric ID and name
    const idOrName = parseInt(repoParam, 10);
    api.getRepo(isNaN(idOrName) ? repoParam : idOrName).then((res) => {
      if (res.ok && res.data) {
        setRepo(res.data);
        setHookEnabled(res.data.hookEnabled);
        setHookApiKey(res.data.hookApiKey);
        // Fetch commits and git status after repo is confirmed to exist
        const id = res.data.id;
        if (id > 0) {
          setCommitsRefreshing(true);
          api.getRepoCommits(id, 20).then((cr) => {
            if (cr.ok && cr.data) setCommits(cr.data.commits);
            setCommitsRefreshing(false);
          });
          api.getRepoStatus(id).then((sr) => {
            if (sr.ok && sr.data) setRepoDirty(sr.data.dirty);
          });
        }
      } else {
        toast(res.error ?? "Failed to load project", { variant: "error" });
      }
      setLoading(false);
    });
  }, [repoParam, toast]);

  const fetchCommits = useCallback(() => {
    if (repoId <= 0) return;
    setCommitsRefreshing(true);
    api.getRepoCommits(repoId, 20).then((res) => {
      if (res.ok && res.data) setCommits(res.data.commits);
      setCommitsRefreshing(false);
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
      api.getCloudflareSettings().then((res) => {
        const data = res.data;
        if (res.ok && data?.zones?.length) {
          setCfZones(data.zones);
          const defaultZ = data.defaultZone && data.zones.some((z) => z.zoneName === data.defaultZone)
            ? data.defaultZone
            : data.zones[0].zoneName;
          setSelectedZone(defaultZ);
        }
      }).catch(() => {});
    }
  }, [connected, fetchRepo]);

  const handleSaveDomain = async () => {
    if (!repo || !selectedZone) return;
    const portNum = Number(domainForm.port);
    if (!domainForm.port || isNaN(portNum) || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      toast("Port must be a valid number between 1 and 65535", { variant: "error" });
      return;
    }
    const domain = domainForm.useRootDomain
      ? selectedZone
      : `${domainForm.subdomain.trim() || repo.name}.${selectedZone}`;
    setDomainSaving(true);
    const res = await api.updateRepoDomain(repo.id, {
      domain,
      forwardHost: "localhost",
      forwardPort: Number(domainForm.port),
      forwardScheme: "http",
    });
    if (res.ok && res.data) {
      const data = res.data as RepositoryInfo & { warnings?: string[] };
      setRepo(data);
      if (data.warnings?.length) {
        for (const w of data.warnings) toast(w, { variant: "warning" });
        toast(`Domain ${domain} connected, but sync had issues`, { variant: "warning" });
      } else {
        toast(`Domain ${domain} connected`, { variant: "success" });
      }
    } else {
      toast(res.error ?? "Failed to save domain", { variant: "error" });
    }
    setDomainSaving(false);
  };

  const handleRemoveDomain = async () => {
    if (!repo) return;
    setDomainSaving(true);
    const res = await api.updateRepoDomain(repo.id, null);
    if (res.ok && res.data) {
      setRepo(res.data);
      toast("Domain disconnected", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to remove domain", { variant: "error" });
    }
    setDomainSaving(false);
  };

  // Restore active terminals
  useEffect(() => {
    if (!repo || restoredRef.current) return;
    restoredRef.current = true;
    api.getActiveTerminals().then((res) => {
      if (!res.ok || !res.data || res.data.length === 0) return;
      const restored: Record<string, string> = {};
      const prefix = `repo-${repo.name}-`;
      for (const t of res.data) {
        if (t.id.startsWith(prefix)) {
          const rest = t.id.slice(prefix.length);
          const lastDash = rest.lastIndexOf("-");
          const slug = lastDash >= 0 ? rest.slice(0, lastDash) : rest;
          if (slug && repo.scripts.some((s) => s.filename === `${slug}.sh` || s.filename === slug)) {
            const key = slug.endsWith(".sh") ? slug.replace(/\.sh$/, "") : slug;
            restored[key] = t.id;
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

  // Close branch dropdown on outside click
  useEffect(() => {
    if (!branchOpen) return;
    const handler = (e: MouseEvent) => {
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [branchOpen]);

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
            for (const key of runningKeys) handleRestartScript(key);
          }
        }
      }
    } else {
      toast(res.error ?? "Pull failed", { variant: "error" });
    }
  };

  const handleRestore = async () => {
    if (!repo) return;
    const yes = await confirm({
      title: "Discard all changes",
      message: "This will discard all uncommitted changes and remove untracked files. This cannot be undone.",
      confirmLabel: "Discard All",
      variant: "destructive",
    });
    if (!yes) return;
    setRestoring(true);
    const res = await api.restoreRepo(repoId);
    setRestoring(false);
    if (res.ok) {
      toast("All changes discarded", { variant: "success" });
      setRepoDirty(false);
      fetchRepo();
    } else {
      toast(res.error ?? "Restore failed", { variant: "error" });
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

  /** Build full script content from simple mode fields */
  const buildScriptContent = (preCmd?: string, cmd?: string): string => {
    const lines = ["#!/bin/bash", "set -e", ""];
    if (preCmd?.trim()) lines.push(preCmd.trim());
    if (cmd?.trim()) lines.push(cmd.trim());
    lines.push("");
    return lines.join("\n");
  };

  /** Parse script content into preCommand + command for simple mode */
  const parseScriptContent = (content: string): { preCommand: string; command: string } => {
    const lines = content.split("\n").filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("#!") && t !== "set -e";
    });
    if (lines.length <= 1) return { preCommand: "", command: lines[0] ?? "" };
    return { preCommand: lines.slice(0, -1).join("\n"), command: lines[lines.length - 1] };
  };

  const handleSaveScript = async () => {
    if (!editingScript) return;
    if (!editingScript.name.trim()) return;

    // Build final content: in simple mode assemble from fields, in advanced use raw content
    const finalContent = editingScript.advancedMode
      ? editingScript.content
      : buildScriptContent(editingScript.preCommand, editingScript.command);

    if (editingScript.slug) {
      const res = await api.updateRepoScript(repoId, editingScript.slug, finalContent, editingScript.name);
      if (res.ok) {
        fetchRepo();
        setEditingScript(null);
        toast("Script saved", { variant: "success" });
      } else {
        toast(res.error ?? "Failed to save script", { variant: "error" });
      }
    } else {
      const res = await api.createRepoScript(repoId, editingScript.name.trim(), finalContent);
      if (res.ok) {
        fetchRepo();
        setEditingScript(null);
        toast("Script created", { variant: "success" });
      } else {
        toast(res.error ?? "Failed to create script", { variant: "error" });
      }
    }
  };

  const handleRunScript = (slug: string) => {
    setExitCodes((prev) => { const next = { ...prev }; delete next[slug]; return next; });
    api.runRepoScript(repoId, slug).then((res) => {
      if (res.ok && res.data) {
        setRunningTerminals((prev) => ({ ...prev, [slug]: res.data!.terminalId }));
        setExpandedTerminals((prev) => new Set(prev).add(slug));
      }
    });
  };

  const handleStopScript = (slug: string) => {
    const terminalId = runningTerminals[slug];
    if (terminalId) api.killTerminal(terminalId);
  };

  const handleRestartScript = (slug: string) => {
    const terminalId = runningTerminals[slug];
    if (!terminalId) return;
    setPendingRestart((prev) => ({ ...prev, [slug]: 1 }));
    api.killTerminal(terminalId);
  };

  const handleTerminalExit = (slug: string, exitCode?: number) => {
    setRunningTerminals((prev) => { const next = { ...prev }; delete next[slug]; return next; });
    if (exitCode !== undefined) setExitCodes((prev) => ({ ...prev, [slug]: exitCode }));
    const restart = pendingRestart[slug];
    if (restart !== undefined) {
      setPendingRestart((prev) => { const next = { ...prev }; delete next[slug]; return next; });
      setTimeout(() => handleRunScript(slug), 300);
    }
  };

  const toggleTerminal = (slug: string) => {
    setExpandedTerminals((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };

  const handleEditScript = async (script: { name: string; filename: string }) => {
    const slug = script.filename.replace(/\.sh$/, "");
    const res = await api.getRepoScript(repoId, slug);
    if (res.ok && res.data) {
      const parsed = parseScriptContent(res.data.content);
      setEditingScript({ slug, name: res.data.name, content: res.data.content, preCommand: parsed.preCommand, command: parsed.command });
    } else {
      toast(res.error ?? "Failed to load script", { variant: "error" });
    }
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
    if (res.ok && res.data) {
      setBranchList(res.data.branches);
    } else {
      setBranchList([]);
      toast(res.error ?? "Failed to load branches", { variant: "error" });
    }
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
          for (const key of runningKeys) handleRestartScript(key);
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
    if (showSuggestions && !suggestionsLoaded) loadSuggestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSuggestions]);

  const handleAddSuggestedScript = (name: string, command: string, preCommand?: string) => {
    const content = preCommand
      ? `#!/bin/bash\nset -e\n\n${preCommand}\n${command}\n`
      : `#!/bin/bash\nset -e\n\n${command}\n`;
    api.createRepoScript(repoId, name, content).then((res) => {
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
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Button variant="ghost" size="sm" iconOnly onClick={() => router.push("/projects")} aria-label="Back">
            <ChevronLeft size={20} />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold truncate">{repo.name}</h1>
              {runningCount > 0 && (
                <Badge variant="success">{runningCount} running</Badge>
              )}
            </div>
            {repo.domainConnections.length > 0 ? (
              <div className="flex items-center gap-3 flex-wrap">
                {repo.domainConnections.map((conn) => (
                  <a key={conn.domain} href={`https://${conn.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-point hover:underline inline-flex items-center gap-1">
                    <Globe size={12} />
                    {conn.domain}
                    <ExternalLink size={10} />
                  </a>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/40 inline-flex items-center gap-1">
                <Globe size={12} />
                No domain connected
              </span>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="relative" ref={branchDropdownRef}>
                <button
                  className="flex items-center gap-1 hover:text-point transition-colors"
                  onClick={toggleBranches}
                  disabled={branchLoading}
                >
                  <GitBranch size={12} />
                  <span className="font-mono">{repo.branch}</span>
                  {branchLoading ? <RefreshCw size={10} className="animate-spin" /> : <ChevronDown size={10} />}
                </button>
                {branchOpen && (
                  <div className="absolute z-50 top-full left-0 mt-1 max-h-60 overflow-auto rounded-lg border border-border bg-surface shadow-lg p-1 min-w-[180px]">
                    {branchList.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No branches found</p>
                    ) : branchList.map((b) => (
                      <button
                        key={b}
                        disabled={checkingOut}
                        onClick={() => handleCheckout(b)}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                          b === repo.branch
                            ? "bg-point/15 text-point font-semibold"
                            : "hover:bg-surface-hover text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                    {checkingOut && (
                      <div className="flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground">
                        <RefreshCw size={10} className="animate-spin" /> Switching...
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span className="text-border">·</span>
              <span className="font-mono truncate max-w-[400px]">{repo.repoUrl}</span>
              <CopyButton value={repo.repoUrl} label="repo URL" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="secondary" leftIcon={<ExternalLink size={14} />}>
                GitHub
              </Button>
            </a>
          )}
          {isManager && (
            <>
              {repoDirty && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleRestore}
                  loading={restoring}
                  leftIcon={restoring ? undefined : <RotateCcw size={14} />}
                >
                  {restoring ? "Restoring..." : "Restore"}
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={handlePull}
                loading={pulling}
                leftIcon={pulling ? undefined : <RefreshCw size={14} />}
              >
                {pulling ? "Pulling..." : "Pull"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDelete}
                leftIcon={<Trash2 size={14} />}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} variant="underline">
        <TabsList>
          <TabTrigger value="scripts">
            <span className="inline-flex items-center gap-1.5">
              Scripts
              {repo.scripts.length > 0 && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{repo.scripts.length}</span>
              )}
            </span>
          </TabTrigger>
          <TabTrigger value="env">Environment</TabTrigger>
          <TabTrigger value="webhook">
            <span className="inline-flex items-center gap-1.5">
              Webhook
              {hookEnabled && <StatusDot status="success" size="sm" />}
            </span>
          </TabTrigger>
          {isManager && <TabTrigger value="domain">Domain</TabTrigger>}
          <TabTrigger value="git">Git</TabTrigger>
        </TabsList>

        {/* Scripts Tab */}
        <TabContent value="scripts">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 size={14} />
                  <p className="text-sm font-semibold">Scripts</p>
                  {repo.scripts.length > 0 && (
                    <span className="text-xs text-muted-foreground">{repo.scripts.length}</span>
                  )}
                </div>
                {isManager && !editingScript && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setShowSuggestions(!showSuggestions); }}>
                      Detect
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingScript({ name: "", content: "", preCommand: "", command: "" })} leftIcon={<Plus size={12} />}>
                      New Script
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Suggestions */}
                {showSuggestions && (() => {
                  const filtered = suggestions.filter(
                    (s) => !repo.scripts.some((existing) => existing.name === s.name),
                  );
                  if (filtered.length === 0) return <p className="text-xs text-muted-foreground py-2 text-center">No suggestions detected</p>;
                  return (
                    <div className="space-y-1 pb-2 border-b border-border">
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

                {/* Editor view */}
                {editingScript && (
                  <div className="space-y-4 border border-point/20 rounded-lg p-4 bg-point/[0.02]">
                    <div className="space-y-1.5">
                      <Input
                        label="Script Name"
                        placeholder="e.g. Deploy Prod"
                        value={editingScript.name}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingScript({ ...editingScript, name: e.target.value })}
                      />
                      {editingScript.name.trim() && (
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {editingScript.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "script"}.sh
                        </p>
                      )}
                    </div>

                    {/* Simple / Advanced toggle */}
                    <div className="flex items-center gap-2">
                      <button
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${!editingScript.advancedMode ? "bg-point/10 text-point font-medium" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => {
                          if (editingScript.advancedMode) {
                            const parsed = parseScriptContent(editingScript.content);
                            setEditingScript({ ...editingScript, advancedMode: false, preCommand: parsed.preCommand, command: parsed.command });
                          }
                        }}
                      >
                        Simple
                      </button>
                      <button
                        className={`text-xs px-2 py-1 rounded-md transition-colors ${editingScript.advancedMode ? "bg-point/10 text-point font-medium" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => {
                          if (!editingScript.advancedMode) {
                            const content = buildScriptContent(editingScript.preCommand, editingScript.command);
                            setEditingScript({ ...editingScript, advancedMode: true, content });
                          }
                        }}
                      >
                        Advanced
                      </button>
                    </div>

                    {!editingScript.advancedMode ? (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">Pre-Run <span className="font-normal">(optional)</span></label>
                          <textarea
                            className="w-full min-h-[60px] p-3 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-point/30 focus:border-point/50 leading-relaxed transition-shadow"
                            placeholder="e.g. cd frontend && pnpm install"
                            value={editingScript.preCommand ?? ""}
                            onChange={(e) => setEditingScript({ ...editingScript, preCommand: e.target.value })}
                            spellCheck={false}
                            rows={2}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-muted-foreground">Run Command</label>
                          <textarea
                            className="w-full min-h-[60px] p-3 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-point/30 focus:border-point/50 leading-relaxed transition-shadow"
                            placeholder="e.g. pnpm run build"
                            value={editingScript.command ?? ""}
                            onChange={(e) => setEditingScript({ ...editingScript, command: e.target.value })}
                            spellCheck={false}
                            rows={2}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Script Content</label>
                        <textarea
                          className="w-full min-h-[200px] p-3 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-point/30 focus:border-point/50 leading-relaxed transition-shadow"
                          placeholder={"#!/bin/bash\nset -e\n\n# Your script here..."}
                          value={editingScript.content}
                          onChange={(e) => setEditingScript({ ...editingScript, content: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Tab") {
                              e.preventDefault();
                              const target = e.target as HTMLTextAreaElement;
                              const start = target.selectionStart;
                              const end = target.selectionEnd;
                              const newContent = editingScript.content.substring(0, start) + "  " + editingScript.content.substring(end);
                              setEditingScript({ ...editingScript, content: newContent });
                              setTimeout(() => { target.selectionStart = target.selectionEnd = start + 2; }, 0);
                            }
                          }}
                          spellCheck={false}
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditingScript(null)}>Cancel</Button>
                      <Button size="sm" onClick={handleSaveScript} disabled={!editingScript.name.trim() || (!editingScript.advancedMode && !editingScript.command?.trim())} leftIcon={<Save size={12} />}>
                        {editingScript.slug ? "Save" : "Create"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Script list */}
                {!editingScript && repo.scripts.length === 0 && (
                  <div className="py-8 text-center space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-point/10 flex items-center justify-center mx-auto">
                      <FileCode2 size={18} className="text-point" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">No scripts yet</p>
                      <p className="text-xs text-muted-foreground">Create a script to automate builds, deploys, and more.</p>
                    </div>
                    {isManager && (
                      <Button size="sm" variant="secondary" onClick={() => setEditingScript({ name: "", content: "", preCommand: "", command: "" })} leftIcon={<Plus size={12} />}>
                        New Script
                      </Button>
                    )}
                  </div>
                )}

                {!editingScript && repo.scripts.map((script) => {
                  const slug = script.filename.replace(/\.sh$/, "");
                  const terminalId = runningTerminals[slug];
                  const isRunning = !!terminalId;
                  const isExpanded = expandedTerminals.has(slug);
                  const isRestarting = !!pendingRestart[slug];
                  const lastExitCode = exitCodes[slug];
                  const hasFailed = lastExitCode !== undefined && lastExitCode !== 0;

                  return (
                    <div key={script.filename} className="space-y-2">
                      <div className={`flex items-center justify-between gap-4 p-4 rounded-lg border transition-colors ${isRunning ? "border-success/30 bg-success/5" : hasFailed ? "border-destructive/30 bg-destructive/5" : "border-border bg-surface"}`}>
                        <div className="min-w-0 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-point/10 flex items-center justify-center shrink-0">
                            <FileCode2 size={14} className="text-point" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{script.name}</p>
                              {isRunning && <Badge variant="success">{isRestarting ? "Restarting" : "Running"}</Badge>}
                              {!isRunning && lastExitCode !== undefined && (
                                <Badge variant={hasFailed ? "destructive" : "success"}>
                                  {hasFailed ? `Exit ${lastExitCode}` : "Done"}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">{script.filename}</p>
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {isRunning ? (
                            <>
                              <Button size="sm" variant="ghost" iconOnly onClick={() => toggleTerminal(slug)} title="Toggle Terminal Output" aria-label="Toggle Terminal Output">
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </Button>
                              <Button size="sm" variant="secondary" iconOnly onClick={() => handleRestartScript(slug)} disabled={isRestarting} title="Restart" aria-label="Restart">
                                <RotateCcw size={12} />
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleStopScript(slug)} leftIcon={<Square size={12} />}>
                                Stop
                              </Button>
                            </>
                          ) : isManager ? (
                            <>
                              <Button size="sm" onClick={() => handleRunScript(slug)} leftIcon={<Play size={12} />}>
                                Run
                              </Button>
                              <Button size="sm" variant="ghost" iconOnly onClick={() => handleEditScript(script)} title="Edit script" aria-label="Edit script">
                                <FileCode2 size={12} />
                              </Button>
                            </>
                          ) : null}
                          {!isRunning && isManager && (
                            <Button
                              size="sm"
                              variant="ghost"
                              iconOnly
                              onClick={() => {
                                api.toggleScriptAutoStart(repoId, slug, !script.autoStart).then((res) => { if (res.ok) fetchRepo(); });
                              }}
                              title={script.autoStart ? "Disable auto-start" : "Enable auto-start"}
                              aria-label="Toggle auto-start"
                            >
                              <Power size={12} className={script.autoStart ? "text-success" : "text-muted-foreground"} />
                            </Button>
                          )}
                          {!isRunning && isManager && hookEnabled && (
                            <Button
                              size="sm"
                              variant="ghost"
                              iconOnly
                              onClick={() => {
                                api.toggleScriptHook(repoId, slug, !(script.hookEnabled !== false)).then((res) => { if (res.ok) fetchRepo(); });
                              }}
                              title={script.hookEnabled !== false ? "Disable webhook" : "Enable webhook"}
                              aria-label="Toggle webhook"
                            >
                              <Webhook size={12} className={script.hookEnabled !== false ? "text-point" : "text-muted-foreground"} />
                            </Button>
                          )}
                          {!isRunning && isManager && (
                            <Button size="sm" variant="ghost" iconOnly onClick={async () => {
                              const yes = await confirm({ title: "Delete script", message: `Delete "${script.name}" (${script.filename})?`, confirmLabel: "Delete", variant: "destructive" });
                              if (!yes) return;
                              api.deleteRepoScript(repoId, slug).then((res) => { if (res.ok) fetchRepo(); });
                            }} title="Delete script" aria-label="Delete script">
                              <Trash2 size={12} />
                            </Button>
                          )}
                        </div>
                      </div>
                      {isRunning && isExpanded && (
                        <div className="rounded-lg border border-border overflow-hidden" style={{ height: "260px" }}>
                          <TerminalView
                            terminalId={terminalId}
                            mode="interactive"
                            rows={12}
                            onExit={(code: number) => handleTerminalExit(slug, code)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <div className="flex items-center gap-1.5 flex-wrap border-b border-border pb-3">
                  {envFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => handleSelectEnvFile(f.path)}
                      className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors border ${
                        selectedEnvPath === f.path
                          ? "bg-point/10 text-point font-semibold border-point/30"
                          : "border-transparent hover:bg-surface-hover text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {f.name}
                    </button>
                  ))}
                  {isManager && (
                    <button
                      onClick={() => setShowAddEnvFile(!showAddEnvFile)}
                      className="px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-point hover:bg-point/5 transition-colors"
                      title="Add env file"
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
                  className="w-full min-h-[200px] p-4 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-point/30 focus:border-point/50 leading-relaxed transition-shadow"
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
                {!hookEnabled && (
                  <div className="py-8 text-center space-y-3">
                    <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                      <Webhook size={18} className="text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Webhook disabled</p>
                      <p className="text-xs text-muted-foreground">Enable webhooks to trigger scripts via HTTP requests.</p>
                    </div>
                  </div>
                )}

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
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 min-w-0">
                            <p className="text-[11px] text-muted-foreground">Trigger a script via HTTP:</p>
                            <code className="block text-xs font-mono text-foreground break-all">
                              {`curl -X POST -H "x-api-key: ${hookApiKey || "<YOUR_KEY>"}" ${typeof window !== "undefined" ? window.location.origin : ""}/api/hook/${repo.name}/<script_name>`}
                            </code>
                          </div>
                          <CopyButton
                            value={`curl -X POST -H "x-api-key: ${hookApiKey || "<YOUR_KEY>"}" ${typeof window !== "undefined" ? window.location.origin : ""}/api/hook/${repo.name}/<script_name>`}
                            label="curl command"
                          />
                        </div>
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
                        <p className="text-xs text-muted-foreground py-6 text-center">No webhook executions yet</p>
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

          {/* Webhook Scripts Card */}
          {hookEnabled && (
            <Card className="mt-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode2 size={14} />
                    <p className="text-sm font-semibold">Webhook Scripts</p>
                  </div>
                  {isManager && (
                    <Button
                      size="sm"
                      variant="ghost"
                      leftIcon={<Plus size={12} />}
                      onClick={() => {
                        setEditingScript({ name: "", content: "", preCommand: "", command: "" });
                        setActiveTab("scripts");
                      }}
                    >
                      New Script
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {repo.scripts.length === 0 ? (
                  <div className="py-6 text-center space-y-2">
                    <FileCode2 size={18} className="text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">No scripts yet. Create a script to use with webhooks.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {repo.scripts.map((script) => {
                      const slug = script.filename.replace(/\.sh$/, "");
                      const enabled = script.hookEnabled !== false;
                      return (
                        <div key={script.filename} className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors ${enabled ? "border-border bg-surface" : "border-border/50 bg-surface/50 opacity-60"}`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <FileCode2 size={14} className={enabled ? "text-point shrink-0" : "text-muted-foreground shrink-0"} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{script.name}</p>
                              <p className="text-[10px] text-muted-foreground font-mono truncate">/api/hook/{repo.name}/{slug}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <CopyButton
                              value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/hook/${repo.name}/${slug}`}
                              label="webhook URL"
                            />
                            {isManager && (
                              <Switch
                                size="sm"
                                checked={enabled}
                                onChange={(v) => {
                                  api.toggleScriptHook(repoId, slug, !enabled).then((res) => { if (res.ok) fetchRepo(); });
                                }}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabContent>

        {/* Domain Tab */}
        {isManager && (
          <TabContent value="domain">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe size={14} />
                  <p className="text-sm font-semibold">Domain Connection</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing connections */}
                {repo.domainConnections.length > 0 && (
                  <div className="space-y-2">
                    {repo.domainConnections.map((conn) => (
                      <div key={conn.domain} className="flex items-center justify-between p-3 rounded-lg border border-border">
                        <div className="space-y-1 min-w-0">
                          <a href={`https://${conn.domain}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-point hover:underline inline-flex items-center gap-1">
                            {conn.domain}
                            <ExternalLink size={12} />
                          </a>
                          <p className="text-xs text-muted-foreground font-mono">
                            → {conn.forwardScheme}://{conn.forwardHost}:{conn.forwardPort}
                          </p>
                        </div>
                        <Button variant="destructive" size="sm" onClick={async () => {
                          setDomainSaving(true);
                          const res = await api.removeDomain(repo.id, conn.domain);
                          if (res.ok && res.data) { setRepo(res.data); toast(`Disconnected ${conn.domain}`, { variant: "success" }); }
                          else { toast(res.error ?? "Failed to disconnect", { variant: "error" }); }
                          setDomainSaving(false);
                        }} loading={domainSaving}>
                          Disconnect
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add new connection form */}
                {cfZones.length > 0 ? (
                  <div className="space-y-3 border-t border-border pt-4">
                    <p className="text-xs font-medium">Add Domain</p>
                    <div className="flex items-end gap-2">
                      {!domainForm.useRootDomain && (
                        <>
                          <div className="min-w-0">
                            <label className="text-xs font-medium mb-1 block">Subdomain</label>
                            <Input
                              value={domainForm.subdomain}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomainForm((f) => ({ ...f, subdomain: e.target.value }))}
                              placeholder={repo.name}
                            />
                          </div>
                          <span className="flex items-center h-[var(--input-md-height)] text-sm text-muted-foreground pb-px">.</span>
                        </>
                      )}
                      <div className={domainForm.useRootDomain ? "flex-1" : "min-w-[180px]"}>
                        <label className="text-xs font-medium mb-1 block">Zone</label>
                        <Select
                          options={cfZones.map((z) => ({ value: z.zoneName, label: z.zoneName }))}
                          value={selectedZone}
                          onChange={(v: string) => setSelectedZone(v)}
                        />
                      </div>
                    </div>
                    {!domainForm.useRootDomain && (
                      <p className="text-xs text-muted-foreground">Defaults to project name if empty</p>
                    )}
                    <Switch
                      label="Use root domain (without subdomain)"
                      checked={domainForm.useRootDomain}
                      onChange={(v) => setDomainForm((f) => ({ ...f, useRootDomain: v }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      {domainForm.useRootDomain ? selectedZone : `${domainForm.subdomain || repo.name}.${selectedZone}`}
                    </p>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Port</label>
                      <Input
                        type="number"
                        min="1"
                        max="65535"
                        value={domainForm.port}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomainForm((f) => ({ ...f, port: e.target.value }))}
                        placeholder="3000"
                        className="w-32"
                      />
                      <p className="text-xs text-muted-foreground mt-1">localhost:{domainForm.port || "3000"}</p>
                    </div>
                    <Button size="sm" onClick={handleSaveDomain} loading={domainSaving}>
                      Connect Domain
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Configure Cloudflare zones in Settings to enable domain connection.</p>
                )}
              </CardContent>
            </Card>
          </TabContent>
        )}

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
                  <RefreshCw size={12} className={commitsRefreshing ? "animate-spin" : ""} />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Info grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Local Path</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-mono text-muted-foreground truncate">{repo.path}</span>
                      <CopyButton value={repo.path} label="path" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Branch</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        <GitBranch size={10} className="mr-1" />
                        {repo.branch}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Recent Commits */}
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Recent Commits</p>
                  {commits.length > 0 ? (
                    <div className="space-y-0.5">
                      {commits.map((c) => (
                        <div key={c.hash} className="flex items-baseline gap-2 text-xs py-1.5 px-2 rounded-md hover:bg-surface-hover transition-colors">
                          <code className="text-[11px] text-point font-mono shrink-0">{c.shortHash}</code>
                          <span className="truncate">{c.message}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0 ml-auto">{c.author} · {formatRelativeDate(c.date)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-2 text-center">No commits loaded</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabContent>
      </Tabs>
    </motion.div>
  );
}
