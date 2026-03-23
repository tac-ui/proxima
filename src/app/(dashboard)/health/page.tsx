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
} from "@tac-ui/web";
import { Plus, RefreshCw, Trash2, HeartPulse, ExternalLink } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";

interface HealthDomain {
  url: string;
  name: string;
  addedAt: string;
}

interface CheckResult {
  url: string;
  status: "up" | "down";
  statusCode?: number;
  responseTime: number;
  error?: string;
}

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

  const fetchDomains = useCallback(async () => {
    const res = await api.getHealthCheckDomains();
    if (res.ok && res.data) setDomains(res.data);
    setLoading(false);
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
    fetchDomains().then(() => {});
  }, [fetchDomains]);

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

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-xl font-bold">Health Check</h1>
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
          {isManager && (
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
              Add Domain
            </Button>
          )}
        </div>
      </div>

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
      ) : domains.length === 0 ? (
        <EmptyState
          icon={<HeartPulse size={32} className="text-muted-foreground" />}
          title="No domains monitored"
          description="Add domains to monitor their availability."
          action={
            isManager ? (
              <Button onClick={() => setShowAdd(true)} leftIcon={<Plus size={14} />}>
                Add Domain
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
          {domains.map((domain) => {
            const result = results[domain.url];
            const isUp = result?.status === "up";
            const isDown = result?.status === "down";
            const isChecking = checking && !result;

            return (
              <Card key={domain.url}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status indicator */}
                    <Tooltip content={isUp ? `${result.statusCode} OK` : isDown ? (result.error || `${result.statusCode}`) : "Checking..."} placement="top">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${isUp ? "bg-success" : isDown ? "bg-destructive" : "bg-muted-foreground animate-pulse"}`} />
                    </Tooltip>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{domain.name}</span>
                        {result && (
                          <span className={`text-[11px] font-mono ${isUp ? "text-success" : "text-destructive"}`}>
                            {result.responseTime}ms
                          </span>
                        )}
                        {result?.statusCode && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${isUp ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
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
                    </div>
                  </div>

                  {isManager && (
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      onClick={() => handleRemove(domain.url, domain.name)}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
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
