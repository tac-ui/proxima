"use client";

import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  Card,
  CardContent,
  Button,
  Input,
  EmptyState,
  Skeleton,
  Tooltip,
  useToast,
  pageEntrance,
  SegmentController,
} from "@tac-ui/web";
import { Plus, RefreshCw, Trash2, HeartPulse, ExternalLink, Edit, Check, X } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import type { ProxyHost } from "@/types";

interface HealthDomain {
  url: string;
  name: string;
  addedAt: string;
  auto?: boolean;
}

interface CheckResult {
  url: string;
  status: "up" | "down";
  statusCode?: number;
  responseTime: number;
  error?: string;
}

type ViewMode = "all" | "manual" | "auto";
const viewOptions = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "auto", label: "From Routes" },
];

export default function HealthPage() {
  const { toast } = useToast();
  const { isManager } = useAuth();
  const confirm = useConfirm();

  const [domains, setDomains] = useState<HealthDomain[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [routes, setRoutes] = useState<ProxyHost[]>([]);

  const fetchDomains = useCallback(async () => {
    const res = await api.getHealthCheckDomains();
    if (res.ok && res.data) setDomains(res.data);
    setLoading(false);
  }, []);

  const fetchRoutes = useCallback(async () => {
    const res = await api.getRoutes();
    if (res.ok && res.data) setRoutes(res.data);
  }, []);

  const runChecks = useCallback(async (domainList: HealthDomain[]) => {
    if (domainList.length === 0) return;
    setChecking(true);
    const res = await api.checkHealthDomains(domainList.map((d) => d.url));
    if (res.ok && res.data) {
      const map: Record<string, CheckResult> = {};
      for (const r of res.data) map[r.url] = r;
      setResults(map);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    fetchDomains();
    fetchRoutes();
  }, [fetchDomains, fetchRoutes]);

  useEffect(() => {
    if (!loading && domains.length > 0) runChecks(domains);
  }, [loading, domains, runChecks]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    if (domains.length === 0) return;
    const interval = setInterval(() => runChecks(domains), 60_000);
    return () => clearInterval(interval);
  }, [domains, runChecks]);

  const handleAdd = async () => {
    if (!addUrl.trim()) return;
    setAdding(true);
    const res = await api.addHealthCheckDomain(addUrl.trim(), addName.trim());
    if (res.ok && res.data) {
      setDomains(res.data);
      setAddUrl("");
      setAddName("");
      setShowAdd(false);
      toast("Domain added", { variant: "success" });
      runChecks(res.data);
    } else {
      toast(res.error ?? "Failed to add", { variant: "error" });
    }
    setAdding(false);
  };

  const handleImportFromRoutes = async () => {
    const existing = new Set(domains.map((d) => d.url));
    const newDomains = routes
      .filter((r) => r.enabled)
      .flatMap((r) => r.domainNames)
      .map((d) => `https://${d}`)
      .filter((url) => !existing.has(url));

    if (newDomains.length === 0) {
      toast("All route domains are already added", { variant: "info" });
      return;
    }

    let updated = domains;
    for (const url of newDomains) {
      const hostname = new URL(url).hostname;
      const res = await api.addHealthCheckDomain(url, hostname);
      if (res.ok && res.data) updated = res.data;
    }
    setDomains(updated);
    toast(`Imported ${newDomains.length} domain(s)`, { variant: "success" });
    runChecks(updated);
  };

  const handleRemove = async (url: string, name: string) => {
    const yes = await confirm({
      title: "Remove domain",
      message: `Remove "${name}" from health checks?`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!yes) return;
    const res = await api.removeHealthCheckDomain(url);
    if (res.ok && res.data) {
      setDomains(res.data);
      setResults((prev) => { const n = { ...prev }; delete n[url]; return n; });
      toast("Domain removed", { variant: "success" });
    }
  };

  const startEdit = (domain: HealthDomain) => {
    setEditingUrl(domain.url);
    setEditName(domain.name);
    setEditUrl(domain.url);
  };

  const cancelEdit = () => {
    setEditingUrl(null);
  };

  const saveEdit = async (originalUrl: string) => {
    const data: { name?: string; newUrl?: string } = {};
    const domain = domains.find((d) => d.url === originalUrl);
    if (!domain) return;
    if (editName.trim() && editName.trim() !== domain.name) data.name = editName.trim();
    if (editUrl.trim() && editUrl.trim() !== domain.url) data.newUrl = editUrl.trim();
    if (Object.keys(data).length === 0) { setEditingUrl(null); return; }

    const res = await api.updateHealthCheckDomain(originalUrl, data);
    if (res.ok && res.data) {
      setDomains(res.data);
      toast("Updated", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to update", { variant: "error" });
    }
    setEditingUrl(null);
  };

  const filtered = viewMode === "all" ? domains
    : viewMode === "auto" ? domains.filter((d) => d.auto)
    : domains.filter((d) => !d.auto);

  // Stats
  const upCount = Object.values(results).filter((r) => r.status === "up").length;
  const downCount = Object.values(results).filter((r) => r.status === "down").length;

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Health Check</h1>
          {domains.length > 0 && !loading && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-success font-medium">{upCount} up</span>
              {downCount > 0 && <span className="text-destructive font-medium">{downCount} down</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => runChecks(domains)}
            loading={checking}
            leftIcon={checking ? undefined : <RefreshCw size={14} />}
            disabled={domains.length === 0}
          >
            {checking ? "Checking..." : "Refresh"}
          </Button>
          {isManager && routes.length > 0 && (
            <Button size="sm" variant="secondary" onClick={handleImportFromRoutes}>
              Import from Routes
            </Button>
          )}
          {isManager && (
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
              Add Domain
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      {domains.length > 0 && (
        <SegmentController
          size="sm"
          options={viewOptions}
          value={viewMode}
          onChange={(v) => setViewMode(v as ViewMode)}
        />
      )}

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium mb-1 block">URL</label>
              <Input
                value={addUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
            <div className="w-48">
              <label className="text-xs font-medium mb-1 block">Name (optional)</label>
              <Input
                value={addName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddName(e.target.value)}
                placeholder="My Service"
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
            <Button onClick={handleAdd} loading={adding} disabled={!addUrl.trim()}>
              Add
            </Button>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Domain list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={72} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<HeartPulse size={32} className="text-muted-foreground" />}
          title={viewMode !== "all" ? "No domains in this category" : "No domains monitored"}
          description={viewMode !== "all" ? "Switch to All to see all domains." : "Add domains to monitor their availability."}
          action={
            isManager && viewMode === "all" ? (
              <Button onClick={() => setShowAdd(true)} leftIcon={<Plus size={14} />}>
                Add Domain
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((domain) => {
            const result = results[domain.url];
            const isUp = result?.status === "up";
            const isDown = result?.status === "down";
            const isEditing = editingUrl === domain.url;

            return (
              <Card key={domain.url}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status indicator */}
                    <Tooltip content={isUp ? `${result.statusCode} OK` : isDown ? (result.error || `${result.statusCode}`) : "Checking..."} placement="top">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${isUp ? "bg-success" : isDown ? "bg-destructive" : "bg-muted-foreground animate-pulse"}`} />
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input
                            value={editName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)}
                            placeholder="Name"
                            size="sm"
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(domain.url); if (e.key === "Escape") cancelEdit(); }}
                          />
                          <Input
                            value={editUrl}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditUrl(e.target.value)}
                            placeholder="https://example.com"
                            size="sm"
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") saveEdit(domain.url); if (e.key === "Escape") cancelEdit(); }}
                          />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{domain.name}</span>
                            {domain.auto && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Auto</span>
                            )}
                            {result && (
                              <span className={`text-[11px] font-mono ${isUp ? "text-success" : "text-destructive"}`}>
                                {result.responseTime}ms
                              </span>
                            )}
                            {result?.statusCode !== undefined && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                result.statusCode < 300 ? "bg-success/10 text-success"
                                : result.statusCode < 400 ? "bg-point/10 text-point"
                                : result.statusCode < 500 ? "bg-warning/10 text-warning"
                                : "bg-destructive/10 text-destructive"
                              }`}>
                                {result.statusCode}
                              </span>
                            )}
                          </div>
                          <a
                            href={domain.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-point transition-colors inline-flex items-center gap-1 font-mono truncate"
                          >
                            {domain.url}
                            <ExternalLink size={10} />
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {isEditing ? (
                        <>
                          <Tooltip content="Save" placement="top">
                            <Button variant="ghost" size="sm" iconOnly onClick={() => saveEdit(domain.url)}>
                              <Check size={14} className="text-success" />
                            </Button>
                          </Tooltip>
                          <Tooltip content="Cancel" placement="top">
                            <Button variant="ghost" size="sm" iconOnly onClick={cancelEdit}>
                              <X size={14} />
                            </Button>
                          </Tooltip>
                        </>
                      ) : (
                        <>
                          <Tooltip content="Edit" placement="top">
                            <Button variant="ghost" size="sm" iconOnly onClick={() => startEdit(domain)}>
                              <Edit size={14} />
                            </Button>
                          </Tooltip>
                          <Tooltip content="Remove" placement="top">
                            <Button variant="ghost" size="sm" iconOnly onClick={() => handleRemove(domain.url, domain.name)}>
                              <Trash2 size={14} className="text-destructive" />
                            </Button>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
