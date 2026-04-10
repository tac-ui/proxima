"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useApiContext } from "@/contexts/ApiContext";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toHttpsUrl, toSshUrl, isSshUrl, isHttpsUrl } from "@/lib/url-utils";
import {
  Card,
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
  SegmentController,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import {
  Github,
  Plus,
  RefreshCw,
  GitBranch,
  Key,
  Webhook,
} from "@tac-ui/icon";
import type { RepositoryInfo, GitCloneProgress, SshKeyInfo } from "@/types";

export default function ProjectsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { connected, subscribe } = useApiContext();
  const { isManager } = useAuth();

  const [repos, setRepos] = useState<RepositoryInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Clone form
  const [showCloneForm, setShowCloneForm] = useState(false);
  const [cloneMethod, setCloneMethod] = useState<"ssh" | "https">("ssh");
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
  const selectedSshKeyIdRef = useRef<number | null>(null);

  // Import state
  const [showImportModal, setShowImportModal] = useState(false);
  const [unregistered, setUnregistered] = useState<{ name: string; repoUrl: string; branch: string }[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  // Pull state
  const [pullingAll, setPullingAll] = useState(false);

  // Running terminals count
  const [runningCounts, setRunningCounts] = useState<Record<number, number>>({});

  // --- Data fetching ---

  const fetchRepos = useCallback(() => {
    api.getRepos().then((res) => {
      if (res.ok && res.data) setRepos(res.data);
      setLoading(false);
    });
  }, []);

  const openImportModal = useCallback(async () => {
    setShowImportModal(true);
    setImportLoading(true);
    const res = await api.getUnregisteredRepos();
    if (res.ok && res.data) setUnregistered(res.data);
    setImportLoading(false);
  }, []);

  const handleImport = useCallback(async (name: string) => {
    setImporting(name);
    const res = await api.importRepo(name);
    if (res.ok && res.data) {
      toast(`Imported ${name}`, { variant: "success" });
      setUnregistered((prev) => prev.filter((r) => r.name !== name));
      fetchRepos();
    } else {
      toast(res.error ?? "Failed to import", { variant: "error" });
    }
    setImporting(null);
  }, [fetchRepos, toast]);

  const fetchSshKeys = useCallback(() => {
    api.getSshKeys().then((res) => {
      if (res.ok && res.data) {
        setSshKeys(res.data);
        if (res.data.length > 0 && selectedSshKeyIdRef.current === null) {
          const id = res.data[res.data.length - 1].id;
          setSelectedSshKeyId(id);
          selectedSshKeyIdRef.current = id;
        }
      }
    });
  }, []);

  useEffect(() => {
    fetchRepos();
    fetchSshKeys();
  }, [fetchRepos, fetchSshKeys]);

  // Count running terminals per repo
  useEffect(() => {
    if (repos.length === 0) return;
    api.getActiveTerminals().then((res) => {
      if (!res.ok || !res.data) return;
      const counts: Record<number, number> = {};
      for (const t of res.data) {
        for (const repo of repos) {
          if (t.id.startsWith(`repo-${repo.name}-`)) {
            counts[repo.id] = (counts[repo.id] || 0) + 1;
            break;
          }
        }
      }
      setRunningCounts(counts);
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

  const totalRunning = useMemo(
    () => Object.values(runningCounts).reduce((a, b) => a + b, 0),
    [runningCounts],
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

    const selectedKey = cloneMethod === "ssh" ? sshKeys.find((k) => k.id === selectedSshKeyId) : undefined;
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

  const handlePullAll = async () => {
    setPullingAll(true);
    const results = await Promise.allSettled(
      repos.map((r) => api.pullRepo(r.id))
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) toast(`${failed} repo(s) failed to pull`, { variant: "warning" });
    else toast("All repos pulled", { variant: "success" });
    fetchRepos();
    setPullingAll(false);
  };

  // Parse GitHub URL for branch
  const parseGithubUrl = (url: string) => {
    const cleanUrl = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
    const treeMatch = cleanUrl.match(/github\.com\/[^/]+\/[^/]+\/tree\/([^/?#]+)/);
    if (treeMatch) {
      const repoBase = cleanUrl.replace(/\/tree\/[^/?#]+/, "");
      return { repoUrl: repoBase.endsWith(".git") ? repoBase : repoBase + ".git", branch: treeMatch[1] };
    }
    return { repoUrl: cleanUrl, branch: "" };
  };

  // --- Render ---

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Page actions bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
                leftIcon={pullingAll ? undefined : <RefreshCw size={14} />}
                onClick={handlePullAll}
                loading={pullingAll}
              >
                {pullingAll ? "Pulling..." : "Pull All"}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={openImportModal}
            >
              Import
            </Button>
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

      <LoadingIndicator visible={loading || pullingAll} />

      {/* Clone Modal */}
      {typeof document !== "undefined" && createPortal(
        <Modal open={showCloneForm} onClose={() => { if (!cloning) setShowCloneForm(false); }} size="md">
          <ModalHeader>
            <ModalTitle>Clone Repository</ModalTitle>
            <ModalDescription>Clone a Git repository into your projects</ModalDescription>
          </ModalHeader>
          <div className="px-6 pb-2 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Protocol</label>
              <SegmentController
                options={[
                  { value: "ssh", label: "SSH" },
                  { value: "https", label: "HTTPS" },
                ]}
                value={cloneMethod}
                onChange={(v) => {
                  const method = v as "ssh" | "https";
                  setCloneMethod(method);
                  if (repoUrl) {
                    setRepoUrl(method === "ssh" ? toSshUrl(repoUrl) : toHttpsUrl(repoUrl));
                  }
                }}
              />
            </div>

            <Input
              label="Repository URL"
              value={repoUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const url = e.target.value;
                const parsed = parseGithubUrl(url);
                let finalUrl = parsed.repoUrl !== url ? parsed.repoUrl : url;
                if (parsed.branch) setBranch(parsed.branch);
                if (isSshUrl(finalUrl) && cloneMethod !== "ssh") setCloneMethod("ssh");
                else if (isHttpsUrl(finalUrl) && cloneMethod !== "https") setCloneMethod("https");
                if (cloneMethod === "ssh" && isHttpsUrl(finalUrl)) finalUrl = toSshUrl(finalUrl);
                else if (cloneMethod === "https" && isSshUrl(finalUrl)) finalUrl = toHttpsUrl(finalUrl);
                setRepoUrl(finalUrl);
                const cleanUrl = finalUrl;
                if (!targetDir || targetDir === autoDir.current) {
                  const name = cleanUrl.split("/").pop()?.replace(/\.git$/, "") ?? "";
                  setTargetDir(name);
                  autoDir.current = name;
                }
              }}
              placeholder={cloneMethod === "ssh" ? "git@github.com:org/repo.git" : "https://github.com/org/repo.git"}
              error={!!cloneErrors.repoUrl}
              errorMessage={cloneErrors.repoUrl}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            {cloneMethod === "ssh" && (
              <div className="flex items-center gap-2 flex-wrap">
                {sshKeys.length > 0 ? (
                  <Select
                    label="SSH Key"
                    options={[
                      { value: "", label: "No SSH Key" },
                      ...sshKeys.map((k) => ({ value: String(k.id), label: k.alias })),
                    ]}
                    value={selectedSshKeyId ? String(selectedSshKeyId) : ""}
                    onChange={(v: string) => {
                      const id = v ? Number(v) : null;
                      setSelectedSshKeyId(id);
                      selectedSshKeyIdRef.current = id;
                    }}
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
            )}

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

      {/* Import Modal */}
      {typeof document !== "undefined" && createPortal(
        <Modal open={showImportModal} onClose={() => setShowImportModal(false)} size="md">
          <ModalHeader>
            <ModalTitle>Import Project</ModalTitle>
            <ModalDescription>Register existing git repositories from /data/stacks/</ModalDescription>
          </ModalHeader>
          <div className="px-6 pb-2">
            {importLoading ? (
              <div className="space-y-3 py-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} height={48} />
                ))}
              </div>
            ) : unregistered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No unregistered git repositories found</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {unregistered.map((repo) => (
                  <div key={repo.name} className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-surface-hover transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{repo.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{repo.repoUrl || "No remote"} · {repo.branch}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleImport(repo.name)}
                      loading={importing === repo.name}
                      disabled={importing !== null}
                    >
                      Import
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowImportModal(false)}>Close</Button>
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
              <Skeleton key={i} height={80} />
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
            className="space-y-2"
          >
            {repos.map((repo) => {
              const runningCount = runningCounts[repo.id] || 0;
              return (
                <Card
                  key={repo.id}
                  className="cursor-pointer hover:border-point/30 transition-colors"
                  onClick={() => router.push(`/projects/${encodeURIComponent(repo.name)}`)}
                >
                  <div className="flex items-center justify-between px-3 py-3 sm:px-5">
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
                          <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                            <GitBranch size={10} />
                            {repo.branch}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate max-w-[200px] sm:max-w-[400px]">{repo.repoUrl}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {runningCount > 0 && (
                        <Badge variant="success">{runningCount} running</Badge>
                      )}
                      {repo.hookEnabled && (
                        <Badge variant="secondary">
                          <Webhook size={10} className="mr-1" />
                          Webhook
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
