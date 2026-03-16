"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useApiContext } from "@/contexts/ApiContext";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  Button,
  Input,
  Select,
  Alert,
  AlertDescription,
  Progress,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
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
  ChevronDown,
  ChevronUp,
  RefreshCw,
  RotateCcw,
  Save,
  FileCode2,
  GitBranch,
  ExternalLink,
  Key,
} from "@tac-ui/icon";
import { CopyButton } from "@/components/shared/CopyButton";
import dynamic from "next/dynamic";

const TerminalPanel = dynamic(
  () => import("@/components/terminal/TerminalPanel").then((m) => m.TerminalPanel),
  { ssr: false },
);
import { useConfirm } from "@/hooks/useConfirm";
import type { RepositoryInfo, GitCloneProgress, SshKeyInfo, RepoEnvFile } from "@/types";

export default function ProjectsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { connected, subscribe } = useApiContext();
  const { isManager } = useAuth();

  const [repos, setRepos] = useState<RepositoryInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Clone form
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [targetDir, setTargetDir] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<GitCloneProgress | null>(null);
  const [cloneError, setCloneError] = useState("");
  const [cloneErrors, setCloneErrors] = useState<Record<string, string>>({});
  const autoDir = useRef("");

  // SSH Keys
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [selectedSshKeyId, setSelectedSshKeyId] = useState<number | null>(null);

  // Script management
  const [newScriptRepoId, setNewScriptRepoId] = useState<number | null>(null);
  const [newScriptName, setNewScriptName] = useState("");
  const [newScriptCommand, setNewScriptCommand] = useState("");

  // Running terminals
  const [runningTerminals, setRunningTerminals] = useState<Record<string, string>>({});
  const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(new Set());
  const restoredRef = useRef(false);

  // Pending restarts
  const [pendingRestart, setPendingRestart] = useState<Record<string, { repoId: number; scriptIndex: number }>>({});

  // Pull state
  const [pullingRepos, setPullingRepos] = useState<Set<number>>(new Set());
  const [pullingAll, setPullingAll] = useState(false);

  // Env editor (multi-file)
  const [envOpen, setEnvOpen] = useState<Set<number>>(new Set());
  const [envSelectedFile, setEnvSelectedFile] = useState<Record<number, string>>({}); // repoId → selected file path
  const [envContent, setEnvContent] = useState<Record<string, string>>({}); // "repoId:path" → content
  const [envLoaded, setEnvLoaded] = useState<Set<string>>(new Set()); // "repoId:path"
  const [envSaving, setEnvSaving] = useState<Set<string>>(new Set()); // "repoId:path"
  const [showAddEnvFile, setShowAddEnvFile] = useState<number | null>(null);
  const [newEnvFileName, setNewEnvFileName] = useState("");
  const [newEnvFilePath, setNewEnvFilePath] = useState("");

  // Branch switching
  const [branchOpen, setBranchOpen] = useState<Set<number>>(new Set());
  const [branchList, setBranchList] = useState<Record<number, string[]>>({});
  const [branchLoading, setBranchLoading] = useState<Set<number>>(new Set());
  const [checkingOut, setCheckingOut] = useState<Set<number>>(new Set());

  // Script suggestions
  const [suggestions, setSuggestions] = useState<Record<number, { name: string; command: string }[]>>({});
  const [suggestionsLoaded, setSuggestionsLoaded] = useState<Set<number>>(new Set());

  // --- Data fetching ---

  const fetchRepos = useCallback(() => {
    api.getRepos().then((res) => {
      if (res.ok && res.data) setRepos(res.data);
      setLoading(false);
    });
  }, []);

  const fetchSshKeys = useCallback(() => {
    api.getSshKeys().then((res) => {
      if (res.ok && res.data) {
        setSshKeys(res.data);
        // Default to most recently added key
        if (res.data.length > 0 && selectedSshKeyId === null) {
          setSelectedSshKeyId(res.data[res.data.length - 1].id);
        }
      }
    });
  }, []);

  useEffect(() => {
    fetchRepos();
    fetchSshKeys();
  }, [fetchRepos, fetchSshKeys]);

  // Restore active terminals
  useEffect(() => {
    if (repos.length === 0 || restoredRef.current) return;
    restoredRef.current = true;
    api.getActiveTerminals().then((res) => {
      if (!res.ok || !res.data || res.data.length === 0) return;
      const restored: Record<string, string> = {};
      for (const t of res.data) {
        for (const repo of repos) {
          if (t.id.startsWith(`repo-${repo.name}-`)) {
            restored[`${repo.id}-restored`] = t.id;
            break;
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
  }, [repos]);

  // Clone progress via SSE
  const cloneCompletedRef = useRef(false);
  useEffect(() => {
    const handleProgress = (data: { sessionId: string; progress: GitCloneProgress }) => {
      const p = data.progress;
      setCloneProgress(p);
      if (p.progress >= p.total && p.total > 0 && !cloneCompletedRef.current) {
        cloneCompletedRef.current = true;
        setCloning(false);
        setShowCloneForm(false);
        setRepoUrl("");
        setBranch("main");
        setTargetDir("");
        autoDir.current = "";
        setCloneProgress(null);
        fetchRepos();
        toast("Repository cloned successfully", { variant: "success" });
      }
    };
    const unsub = subscribe("gitProgress", handleProgress);
    return unsub;
  }, [fetchRepos, subscribe, toast]);

  // Running counts
  const runningCountByRepo = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const key of Object.keys(runningTerminals)) {
      const repoId = parseInt(key.split("-")[0], 10);
      if (!isNaN(repoId)) counts[repoId] = (counts[repoId] || 0) + 1;
    }
    return counts;
  }, [runningTerminals]);

  const totalRunning = useMemo(
    () => Object.values(runningCountByRepo).reduce((a, b) => a + b, 0),
    [runningCountByRepo],
  );

  // --- Clone handlers ---

  const validateClone = () => {
    const e: Record<string, string> = {};
    if (!repoUrl.trim()) e.repoUrl = "Repository URL is required";
    if (!targetDir.trim()) e.targetDir = "Target directory is required";
    setCloneErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleClone = () => {
    if (!validateClone()) return;
    setCloning(true);
    setCloneProgress(null);
    setCloneError("");
    cloneCompletedRef.current = false;

    const selectedKey = sshKeys.find((k) => k.id === selectedSshKeyId);
    api.cloneRepo({
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || "main",
      sshKeyPath: selectedKey?.keyPath || undefined,
      targetDir: targetDir.trim(),
    }).then((res) => {
      if (!res.ok) {
        setCloning(false);
        setCloneError(res.error ?? "Clone failed");
      }
    });
  };

  const cloneProgressPct =
    cloneProgress && cloneProgress.total > 0
      ? Math.round((cloneProgress.progress / cloneProgress.total) * 100)
      : 0;

  // --- Project handlers ---

  const getRunningScriptKeysForRepo = (repoId: number): string[] => {
    return Object.keys(runningTerminals).filter((key) => key.startsWith(`${repoId}-`) && key !== `${repoId}-restored`);
  };

  const handlePull = async (repoId: number, silent = false) => {
    setPullingRepos((prev) => new Set(prev).add(repoId));
    const res = await api.pullRepo(repoId);
    setPullingRepos((prev) => {
      const next = new Set(prev);
      next.delete(repoId);
      return next;
    });

    if (res.ok && res.data) {
      const isUpToDate = res.data.message.includes("Already up to date");
      if (!silent) toast(res.data.message, { variant: "success" });

      if (!isUpToDate) {
        const runningKeys = getRunningScriptKeysForRepo(repoId);
        if (runningKeys.length > 0) {
          const shouldRestart = await confirm({
            title: "Restart running scripts?",
            message: `Code was updated. ${runningKeys.length} script${runningKeys.length > 1 ? "s are" : " is"} running. Restart to apply changes?`,
            confirmLabel: "Restart All",
          });
          if (shouldRestart) {
            for (const key of runningKeys) {
              const [, indexStr] = key.split("-");
              const scriptIndex = parseInt(indexStr, 10);
              if (!isNaN(scriptIndex)) handleRestartScript(repoId, scriptIndex);
            }
          }
        }
      }
      return true;
    } else {
      if (!silent) toast(res.error ?? "Pull failed", { variant: "error" });
      return false;
    }
  };

  const handlePullAll = async () => {
    setPullingAll(true);
    let successCount = 0;
    let failCount = 0;
    for (const repo of repos) {
      const ok = await handlePull(repo.id, true);
      if (ok) successCount++; else failCount++;
    }
    setPullingAll(false);
    if (failCount === 0) toast(`All ${successCount} projects updated`, { variant: "success" });
    else toast(`${successCount} updated, ${failCount} failed`, { variant: "error" });
  };

  const handleDelete = async (repo: RepositoryInfo) => {
    const ok = await confirm({
      title: "Delete Project",
      message: `Are you sure you want to delete "${repo.name}"? This only removes it from Proxima — the files on disk are not deleted.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const res = await api.deleteRepo(repo.id);
    if (res.ok) { fetchRepos(); toast("Project deleted", { variant: "success" }); }
  };

  const handleAddScript = (repoId: number) => {
    if (!newScriptName.trim() || !newScriptCommand.trim()) return;
    api.addRepoScript(repoId, newScriptName.trim(), newScriptCommand.trim()).then((res) => {
      if (res.ok) { fetchRepos(); setNewScriptRepoId(null); setNewScriptName(""); setNewScriptCommand(""); }
    });
  };

  const handleRunScript = (repoId: number, scriptIndex: number) => {
    const scriptKey = `${repoId}-${scriptIndex}`;
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

  const handleRestartScript = (repoId: number, scriptIndex: number) => {
    const scriptKey = `${repoId}-${scriptIndex}`;
    const terminalId = runningTerminals[scriptKey];
    if (!terminalId) return;
    setPendingRestart((prev) => ({ ...prev, [scriptKey]: { repoId, scriptIndex } }));
    api.killTerminal(terminalId);
  };

  const handleTerminalExit = (scriptKey: string) => {
    setRunningTerminals((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
    const restart = pendingRestart[scriptKey];
    if (restart) {
      setPendingRestart((prev) => { const next = { ...prev }; delete next[scriptKey]; return next; });
      setTimeout(() => handleRunScript(restart.repoId, restart.scriptIndex), 300);
    }
  };

  const toggleTerminal = (scriptKey: string) => {
    setExpandedTerminals((prev) => {
      const next = new Set(prev);
      if (next.has(scriptKey)) next.delete(scriptKey); else next.add(scriptKey);
      return next;
    });
  };

  const getEnvFiles = (repo: RepositoryInfo): RepoEnvFile[] => {
    if (repo.envFiles && repo.envFiles.length > 0) return repo.envFiles;
    return [{ name: ".env", path: ".env" }];
  };

  const envKey = (repoId: number, filePath: string) => `${repoId}:${filePath}`;

  const toggleEnv = async (repoId: number) => {
    if (envOpen.has(repoId)) {
      setEnvOpen((prev) => { const next = new Set(prev); next.delete(repoId); return next; });
      return;
    }
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) return;
    const files = getEnvFiles(repo);
    const selectedPath = envSelectedFile[repoId] || files[0]?.path || ".env";
    setEnvSelectedFile((prev) => ({ ...prev, [repoId]: selectedPath }));
    const key = envKey(repoId, selectedPath);
    if (!envLoaded.has(key)) {
      const res = await api.getRepoEnv(repoId, selectedPath);
      if (res.ok && res.data) {
        setEnvContent((prev) => ({ ...prev, [key]: res.data!.content }));
        setEnvLoaded((prev) => new Set(prev).add(key));
      }
    }
    setEnvOpen((prev) => new Set(prev).add(repoId));
  };

  const handleSelectEnvFile = async (repoId: number, filePath: string) => {
    setEnvSelectedFile((prev) => ({ ...prev, [repoId]: filePath }));
    const key = envKey(repoId, filePath);
    if (!envLoaded.has(key)) {
      const res = await api.getRepoEnv(repoId, filePath);
      if (res.ok && res.data) {
        setEnvContent((prev) => ({ ...prev, [key]: res.data!.content }));
        setEnvLoaded((prev) => new Set(prev).add(key));
      }
    }
  };

  const handleSaveEnv = async (repoId: number) => {
    const filePath = envSelectedFile[repoId] || ".env";
    const key = envKey(repoId, filePath);
    setEnvSaving((prev) => new Set(prev).add(key));
    const res = await api.updateRepoEnv(repoId, envContent[key] ?? "", filePath);
    setEnvSaving((prev) => { const next = new Set(prev); next.delete(key); return next; });
    if (res.ok) toast(`${filePath} saved`, { variant: "success" });
    else toast(res.error ?? `Failed to save ${filePath}`, { variant: "error" });
  };

  const handleAddEnvFile = async (repoId: number) => {
    if (!newEnvFileName.trim() || !newEnvFilePath.trim()) return;
    const res = await api.addRepoEnvFile(repoId, newEnvFileName.trim(), newEnvFilePath.trim());
    if (res.ok) {
      fetchRepos();
      setShowAddEnvFile(null);
      setNewEnvFileName("");
      setNewEnvFilePath("");
      setEnvSelectedFile((prev) => ({ ...prev, [repoId]: newEnvFilePath.trim() }));
      toast("Env file added", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to add env file", { variant: "error" });
    }
  };

  const handleRemoveEnvFile = async (repoId: number, filePath: string) => {
    const ok2 = await confirm({
      title: "Remove env file",
      message: `Remove "${filePath}" from the list? The file on disk won't be deleted.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok2) return;
    const res = await api.removeRepoEnvFile(repoId, filePath);
    if (res.ok) {
      fetchRepos();
      // Switch to first remaining file
      if (envSelectedFile[repoId] === filePath) {
        setEnvSelectedFile((prev) => { const next = { ...prev }; delete next[repoId]; return next; });
      }
      toast("Env file removed", { variant: "success" });
    }
  };

  // Branch handlers
  const toggleBranches = async (repoId: number) => {
    if (branchOpen.has(repoId)) {
      setBranchOpen((prev) => { const next = new Set(prev); next.delete(repoId); return next; });
      return;
    }
    setBranchLoading((prev) => new Set(prev).add(repoId));
    const res = await api.getRepoBranches(repoId);
    setBranchLoading((prev) => { const next = new Set(prev); next.delete(repoId); return next; });
    if (res.ok && res.data) {
      setBranchList((prev) => ({ ...prev, [repoId]: res.data!.branches }));
    }
    setBranchOpen((prev) => new Set(prev).add(repoId));
  };

  const handleCheckout = async (repoId: number, branch: string) => {
    setCheckingOut((prev) => new Set(prev).add(repoId));
    const res = await api.checkoutBranch(repoId, branch);
    setCheckingOut((prev) => { const next = new Set(prev); next.delete(repoId); return next; });
    if (res.ok && res.data) {
      toast(res.data.message, { variant: "success" });
      fetchRepos(); // refresh branch info
      setBranchOpen((prev) => { const next = new Set(prev); next.delete(repoId); return next; });

      // Offer restart if scripts are running
      const runningKeys = getRunningScriptKeysForRepo(repoId);
      if (runningKeys.length > 0) {
        const shouldRestart = await confirm({
          title: "Restart running scripts?",
          message: `Branch changed to ${branch}. Restart running scripts?`,
          confirmLabel: "Restart All",
        });
        if (shouldRestart) {
          for (const key of runningKeys) {
            const [, indexStr] = key.split("-");
            const scriptIndex = parseInt(indexStr, 10);
            if (!isNaN(scriptIndex)) handleRestartScript(repoId, scriptIndex);
          }
        }
      }
    } else {
      toast(res.error ?? "Checkout failed", { variant: "error" });
    }
  };

  // Script suggestion handlers
  const loadSuggestions = async (repoId: number) => {
    if (suggestionsLoaded.has(repoId)) return;
    const res = await api.getSuggestedScripts(repoId);
    if (res.ok && res.data) {
      setSuggestions((prev) => ({ ...prev, [repoId]: res.data!.suggestions }));
      setSuggestionsLoaded((prev) => new Set(prev).add(repoId));
    }
  };

  // Load suggestions when script form opens
  useEffect(() => {
    if (newScriptRepoId !== null && !suggestionsLoaded.has(newScriptRepoId)) {
      loadSuggestions(newScriptRepoId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newScriptRepoId]);

  const handleAddSuggestedScript = (repoId: number, name: string, command: string) => {
    api.addRepoScript(repoId, name, command).then((res) => {
      if (res.ok) {
        fetchRepos();
        // Remove from suggestions
        setSuggestions((prev) => ({
          ...prev,
          [repoId]: (prev[repoId] || []).filter((s) => !(s.name === name && s.command === command)),
        }));
      }
    });
  };

  // Parse GitHub URL for branch
  const parseGithubUrl = (url: string) => {
    // https://github.com/org/repo/tree/branch-name → extract branch
    const treeMatch = url.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^/?#]+)/);
    if (treeMatch) {
      const repoBase = url.replace(/\/tree\/[^/?#]+/, "");
      return { repoUrl: repoBase.endsWith(".git") ? repoBase : repoBase + ".git", branch: treeMatch[1] };
    }
    return { repoUrl: url, branch: "" };
  };

  // --- Render ---

  return (
    <div className="space-y-6">
      {/* Page actions bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {repos.length} project{repos.length !== 1 ? "s" : ""}
          </span>
          {totalRunning > 0 && (
            <Badge variant="success">{totalRunning} running</Badge>
          )}
        </div>
        {isManager && (
          <div className="flex items-center gap-2">
            {repos.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<RefreshCw size={14} className={pullingAll ? "animate-spin" : ""} />}
                onClick={handlePullAll}
                disabled={pullingAll || pullingRepos.size > 0}
              >
                {pullingAll ? "Pulling..." : "Pull All"}
              </Button>
            )}
            <Button
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setShowCloneForm(true)}
            >
              Clone
            </Button>
          </div>
        )}
      </div>

      <LoadingIndicator visible={loading || pullingAll || pullingRepos.size > 0} />

      {/* Clone Modal */}
      {typeof document !== "undefined" && createPortal(
        <Modal open={showCloneForm} onClose={() => { if (!cloning) setShowCloneForm(false); }} size="md">
          <ModalHeader>
            <ModalTitle>Clone Repository</ModalTitle>
            <ModalDescription>Clone a Git repository into your projects</ModalDescription>
          </ModalHeader>
          <div className="px-6 pb-2 space-y-4">
            <Input
              label="Repository URL"
              value={repoUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const url = e.target.value;
                const parsed = parseGithubUrl(url);
                setRepoUrl(parsed.repoUrl !== url ? parsed.repoUrl : url);
                if (parsed.branch) setBranch(parsed.branch);
                const cleanUrl = parsed.repoUrl || url;
                if (!targetDir || targetDir === autoDir.current) {
                  const name = cleanUrl.split("/").pop()?.replace(/\.git$/, "") ?? "";
                  setTargetDir(name);
                  autoDir.current = name;
                }
              }}
              placeholder="https://github.com/org/repo.git"
              error={!!cloneErrors.repoUrl}
              errorMessage={cloneErrors.repoUrl}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Branch"
                value={branch}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBranch(e.target.value)}
                placeholder="main"
              />
              <Input
                label="Target Directory"
                value={targetDir}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTargetDir(e.target.value); autoDir.current = ""; }}
                placeholder="my-project"
                error={!!cloneErrors.targetDir}
                errorMessage={cloneErrors.targetDir}
              />
            </div>

            {/* SSH Key */}
            <div className="flex items-center gap-2 flex-wrap">
              {sshKeys.length > 0 ? (
                <Select
                  label="SSH Key"
                  options={[
                    { value: "", label: "No SSH Key" },
                    ...sshKeys.map((k) => ({ value: String(k.id), label: k.alias })),
                  ]}
                  value={selectedSshKeyId ? String(selectedSshKeyId) : ""}
                  onChange={(v: string) => setSelectedSshKeyId(v ? Number(v) : null)}
                  className="w-full"
                />
              ) : (
                <Link href="/ssh-keys">
                  <Button size="sm" variant="secondary" leftIcon={<Key size={12} />}>
                    Configure SSH Keys
                  </Button>
                </Link>
              )}
            </div>

            {cloneError && (
              <Alert variant="error" dismissible onDismiss={() => setCloneError("")}>
                <AlertDescription>{cloneError}</AlertDescription>
              </Alert>
            )}

            {cloning && cloneProgress && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>{cloneProgress.stage ?? "Initializing..."}</span>
                  <span className="text-muted-foreground">{cloneProgressPct}%</span>
                </div>
                <Progress value={cloneProgressPct} />
              </div>
            )}
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowCloneForm(false)} disabled={cloning}>Cancel</Button>
            <Button disabled={cloning || !connected} onClick={handleClone}>
              {cloning ? "Cloning..." : "Clone"}
            </Button>
          </ModalFooter>
        </Modal>,
        document.body,
      )}

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={160} />
            ))}
          </motion.div>
        ) : repos.length === 0 && !showCloneForm ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="py-12 text-center space-y-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-point/10 flex items-center justify-center mx-auto">
              <GitBranch size={28} className="text-point" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">No projects yet</p>
              <p className="text-xs text-muted-foreground">
                Clone a repository to start managing your projects.
              </p>
            </div>
            {isManager && (
              <Button
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => setShowCloneForm(true)}
              >
                Clone Repository
              </Button>
            )}
          </motion.div>
        ) : repos.length > 0 ? (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {repos.map((repo) => {
        const restoredKey = `${repo.id}-restored`;
        const restoredTerminalId = runningTerminals[restoredKey];
        const isPulling = pullingRepos.has(repo.id);
        const isEnvOpen = envOpen.has(repo.id);
        const runningCount = runningCountByRepo[repo.id] || 0;

        return (
          <Card key={repo.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
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
                      <p className="text-sm font-semibold truncate">{repo.name}</p>
                      <button
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-point transition-colors shrink-0"
                        onClick={() => toggleBranches(repo.id)}
                        disabled={branchLoading.has(repo.id)}
                      >
                        <GitBranch size={10} />
                        {repo.branch}
                        {branchLoading.has(repo.id) ? (
                          <RefreshCw size={8} className="animate-spin" />
                        ) : (
                          <ChevronDown size={8} />
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-mono truncate max-w-[280px]">{repo.repoUrl}</span>
                      <CopyButton value={repo.repoUrl} label="repo URL" />
                    </div>
                  </div>
                </div>
                {isManager && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePull(repo.id)}
                      disabled={isPulling || pullingAll}
                      leftIcon={<RefreshCw size={12} className={isPulling ? "animate-spin" : ""} />}
                    >
                      {isPulling ? "Pulling..." : "Pull"}
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly onClick={() => handleDelete(repo)} title="Delete Project" aria-label="Delete Project">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>

            {/* Branch switcher dropdown */}
            {branchOpen.has(repo.id) && (branchList[repo.id]?.length ?? 0) > 0 && (
              <div className="px-5 pb-0 -mt-2">
                <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-border bg-surface">
                  {branchList[repo.id].map((b) => (
                    <button
                      key={b}
                      disabled={checkingOut.has(repo.id)}
                      onClick={() => handleCheckout(repo.id, b)}
                      className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                        b === repo.branch
                          ? "bg-point/15 text-point font-semibold"
                          : "hover:bg-surface-hover text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                  {checkingOut.has(repo.id) && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RefreshCw size={10} className="animate-spin" /> Switching...
                    </span>
                  )}
                </div>
              </div>
            )}

            <CardContent>
              <div className="space-y-4">
                {/* Scripts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scripts</p>
                    {repo.scripts.length === 0 && newScriptRepoId !== repo.id && (
                      <p className="text-xs text-muted-foreground">No scripts configured</p>
                    )}
                  </div>

                  {restoredTerminalId && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface border border-success/30">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="success">Running</Badge>
                          <p className="text-xs text-muted-foreground font-mono truncate">{restoredTerminalId}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="ghost" iconOnly onClick={() => toggleTerminal(restoredKey)} title="Toggle Terminal Output" aria-label="Toggle Terminal Output">
                            {expandedTerminals.has(restoredKey) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleStopScript(restoredKey)} leftIcon={<Square size={12} />}>
                            Stop
                          </Button>
                        </div>
                      </div>
                      {expandedTerminals.has(restoredKey) && (
                        <TerminalPanel
                          terminalId={restoredTerminalId}
                          title={restoredTerminalId}
                          mode="interactive"
                          rows={15}
                          onExit={() => handleTerminalExit(restoredKey)}
                          showToolbar={true}
                        />
                      )}
                    </div>
                  )}

                  {repo.scripts.map((script, idx) => {
                    const scriptKey = `${repo.id}-${idx}`;
                    const terminalId = runningTerminals[scriptKey];
                    const isRunning = !!terminalId;
                    const isExpanded = expandedTerminals.has(scriptKey);
                    const isRestarting = !!pendingRestart[scriptKey];

                    return (
                      <div key={idx} className="space-y-2">
                        <div className={`flex items-center justify-between gap-2 p-2 rounded-lg bg-surface border ${isRunning ? "border-success/30" : "border-border"}`}>
                          <div className="min-w-0 flex items-center gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{script.name}</p>
                              <p className="text-xs text-muted-foreground font-mono truncate">{script.command}</p>
                            </div>
                            {isRunning && <Badge variant="success">{isRestarting ? "Restarting" : "Running"}</Badge>}
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {isRunning ? (
                              <>
                                <Button size="sm" variant="ghost" iconOnly onClick={() => toggleTerminal(scriptKey)} title="Toggle Terminal Output" aria-label="Toggle Terminal Output">
                                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </Button>
                                <Button size="sm" variant="secondary" iconOnly onClick={() => handleRestartScript(repo.id, idx)} disabled={isRestarting} title="Restart" aria-label="Restart">
                                  <RotateCcw size={12} />
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleStopScript(scriptKey)} leftIcon={<Square size={12} />}>
                                  Stop
                                </Button>
                              </>
                            ) : isManager ? (
                              <Button size="sm" onClick={() => handleRunScript(repo.id, idx)} leftIcon={<Play size={12} />}>
                                Run
                              </Button>
                            ) : null}
                            {!isRunning && isManager && (
                              <Button size="sm" variant="ghost" iconOnly onClick={() => { api.removeRepoScript(repo.id, idx).then((res) => { if (res.ok) fetchRepos(); }); }} title="Delete script" aria-label="Delete script">
                                <X size={12} />
                              </Button>
                            )}
                          </div>
                        </div>
                        {isRunning && isExpanded && (
                          <TerminalPanel
                            terminalId={terminalId}
                            title={script.name}
                            mode="interactive"
                            rows={15}
                            onExit={() => handleTerminalExit(scriptKey)}
                            showToolbar={true}
                          />
                        )}
                      </div>
                    );
                  })}

                  {newScriptRepoId === repo.id ? (
                    <div className="space-y-2">
                      {/* Script suggestions */}
                      {(() => {
                        const repoSuggestions = (suggestions[repo.id] || []).filter(
                          (s) => !repo.scripts.some((existing) => existing.name === s.name || existing.command === s.command),
                        );
                        if (repoSuggestions.length === 0) return null;
                        return (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Detected scripts</p>
                            <div className="flex flex-wrap gap-1.5">
                              {repoSuggestions.map((s) => (
                                <button
                                  key={`${s.name}-${s.command}`}
                                  onClick={() => handleAddSuggestedScript(repo.id, s.name, s.command)}
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
                      <div className="flex gap-2">
                        <Input placeholder="Script name" value={newScriptName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScriptName(e.target.value)} className="flex-1" />
                        <Input
                          placeholder="Command (e.g. npm run dev)"
                          value={newScriptCommand}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScriptCommand(e.target.value)}
                          className="flex-1"
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAddScript(repo.id); if (e.key === "Escape") setNewScriptRepoId(null); }}
                        />
                        <Button size="sm" onClick={() => handleAddScript(repo.id)}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => setNewScriptRepoId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : isManager ? (
                    <Button size="sm" variant="secondary" onClick={() => setNewScriptRepoId(repo.id)} leftIcon={<Plus size={12} />}>
                      Add Script
                    </Button>
                  ) : null}
                </div>

                {/* Environment Variables */}
                {(() => {
                  const files = getEnvFiles(repo);
                  const selectedPath = envSelectedFile[repo.id] || files[0]?.path || ".env";
                  const key = envKey(repo.id, selectedPath);
                  return (
                    <div className="space-y-2 border-t border-border pt-3">
                      <button
                        onClick={() => toggleEnv(repo.id)}
                        className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
                      >
                        {isEnvOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        <FileCode2 size={12} />
                        Environment Variables
                        {files.length > 1 && (
                          <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                            {files.length} files
                          </span>
                        )}
                      </button>
                      {isEnvOpen && (
                        <div className="space-y-2">
                          {/* File selector tabs */}
                          <div className="flex items-center gap-1 flex-wrap">
                            {files.map((f) => (
                              <button
                                key={f.path}
                                onClick={() => handleSelectEnvFile(repo.id, f.path)}
                                className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                                  selectedPath === f.path
                                    ? "bg-point/15 text-point font-semibold"
                                    : "hover:bg-surface-hover text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {f.name}
                              </button>
                            ))}
                            {isManager && (
                              <button
                                onClick={() => setShowAddEnvFile(showAddEnvFile === repo.id ? null : repo.id)}
                                className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-point hover:bg-point/5 transition-colors"
                              >
                                <Plus size={12} />
                              </button>
                            )}
                          </div>

                          {/* Add env file form */}
                          {showAddEnvFile === repo.id && (
                            <div className="flex gap-2 items-end">
                              <Input
                                placeholder="Display name"
                                value={newEnvFileName}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEnvFileName(e.target.value)}
                                className="flex-1"
                              />
                              <Input
                                placeholder="Path (e.g. backend/.env)"
                                value={newEnvFilePath}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEnvFilePath(e.target.value)}
                                className="flex-1"
                              />
                              <Button size="sm" onClick={() => handleAddEnvFile(repo.id)}>Add</Button>
                              <Button size="sm" variant="ghost" onClick={() => { setShowAddEnvFile(null); setNewEnvFileName(""); setNewEnvFilePath(""); }}>
                                <X size={12} />
                              </Button>
                            </div>
                          )}

                          {/* Editor */}
                          <textarea
                            className="w-full min-h-[120px] p-3 rounded-lg border border-border bg-surface text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-point/50"
                            placeholder={"# Add environment variables here\nPORT=3000\nDATABASE_URL=..."}
                            value={envContent[key] ?? ""}
                            onChange={(e) => setEnvContent((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                          {isManager && (
                            <div className="flex items-center justify-between">
                              <div>
                                {selectedPath !== ".env" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleRemoveEnvFile(repo.id, selectedPath)}
                                  >
                                    <Trash2 size={12} />
                                  </Button>
                                )}
                              </div>
                              <Button size="sm" onClick={() => handleSaveEnv(repo.id)} disabled={envSaving.has(key)} leftIcon={<Save size={12} />}>
                                {envSaving.has(key) ? "Saving..." : `Save ${selectedPath}`}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Footer */}
                <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border pt-2">
                  <span className="font-mono truncate">{repo.path}</span>
                  {repo.repoUrl.includes("github.com") && (
                    <a
                      href={repo.repoUrl.replace(/\.git$/, "")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-foreground transition-colors shrink-0"
                    >
                      <ExternalLink size={10} />
                      GitHub
                    </a>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
