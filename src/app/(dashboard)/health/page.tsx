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
  Switch,
  Select,
  Textarea,
  Badge,
} from "@tac-ui/web";
import { Plus, RefreshCw, Trash2, HeartPulse, ExternalLink, Edit, Check, X, Clock, Settings } from "@tac-ui/icon";
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

interface HealthCheckConfig {
  enabled: boolean;
  intervalMinutes: number;
  scheduleTimes?: string[];
  mode: "interval" | "schedule";
  messageTemplate?: string;
  recoveryMessageTemplate?: string;
}

const DEFAULT_DOWN_TEMPLATE =
  "\u{1F534} {domain} is DOWN \u2014 Status: {statusCode}, Response time: {responseTime}ms";
const DEFAULT_RECOVERY_TEMPLATE =
  "\u{1F7E2} {domain} is back UP \u2014 Response time: {responseTime}ms";

const INTERVAL_OPTIONS = [
  { value: "1", label: "Every 1 minute" },
  { value: "5", label: "Every 5 minutes" },
  { value: "10", label: "Every 10 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every 1 hour" },
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
  const [addMode, setAddMode] = useState<"manual" | "routes">("manual");
  const [selectedRouteDomains, setSelectedRouteDomains] = useState<Set<string>>(new Set());
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [routes, setRoutes] = useState<ProxyHost[]>([]);

  // Schedule config state
  const [showScheduleConfig, setShowScheduleConfig] = useState(false);
  const [config, setConfig] = useState<HealthCheckConfig>({
    enabled: false,
    intervalMinutes: 5,
    mode: "interval",
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState("09:00");

  const fetchDomains = useCallback(async () => {
    const res = await api.getHealthCheckDomains();
    if (res.ok && res.data) setDomains(res.data);
    setLoading(false);
  }, []);

  const fetchRoutes = useCallback(async () => {
    const res = await api.getRoutes();
    if (res.ok && res.data) setRoutes(res.data);
  }, []);

  const fetchConfig = useCallback(async () => {
    setConfigLoading(true);
    const res = await api.getHealthCheckConfig();
    if (res.ok && res.data) setConfig(res.data);
    setConfigLoading(false);
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
    fetchConfig();
  }, [fetchDomains, fetchRoutes, fetchConfig]);

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

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    const res = await api.updateHealthCheckConfig(config);
    if (res.ok && res.data) {
      setConfig(res.data);
      toast("Schedule config saved", { variant: "success" });
    } else {
      toast(res.error ?? "Failed to save config", { variant: "error" });
    }
    setConfigSaving(false);
  };

  const addScheduleTime = () => {
    if (!newScheduleTime) return;
    const times = config.scheduleTimes ?? [];
    if (times.includes(newScheduleTime)) return;
    setConfig({ ...config, scheduleTimes: [...times, newScheduleTime].sort() });
  };

  const removeScheduleTime = (time: string) => {
    setConfig({
      ...config,
      scheduleTimes: (config.scheduleTimes ?? []).filter((t) => t !== time),
    });
  };

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
          {isManager && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Settings size={14} />}
              onClick={() => setShowScheduleConfig(!showScheduleConfig)}
            >
              Schedule
            </Button>
          )}
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
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => { setShowAdd(true); setAddMode("manual"); }}>
              Add Domain
            </Button>
          )}
        </div>
      </div>

      {/* Schedule config */}
      {showScheduleConfig && isManager && (
        <Card>
          <CardContent className="space-y-5 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock size={18} className="text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold">Health Check Schedule</h3>
                  <p className="text-xs text-muted-foreground">
                    Automatically check domains and send notifications on status changes
                  </p>
                </div>
              </div>
              {configLoading ? (
                <Skeleton width={44} height={24} />
              ) : (
                <Switch
                  checked={config.enabled}
                  onChange={(checked) => setConfig({ ...config, enabled: checked })}
                  size="sm"
                />
              )}
            </div>

            {config.enabled && (
              <>
                {/* Mode selector */}
                <div className="space-y-2">
                  <label className="text-xs font-medium block">Check Mode</label>
                  <SegmentController
                    size="sm"
                    options={[
                      { value: "interval", label: "Interval" },
                      { value: "schedule", label: "Scheduled Times" },
                    ]}
                    value={config.mode}
                    onChange={(v) => setConfig({ ...config, mode: v as "interval" | "schedule" })}
                  />
                </div>

                {/* Interval mode */}
                {config.mode === "interval" && (
                  <div className="space-y-2">
                    <Select
                      label="Check Interval"
                      size="sm"
                      options={INTERVAL_OPTIONS}
                      value={String(config.intervalMinutes)}
                      onChange={(v) => setConfig({ ...config, intervalMinutes: Number(v) })}
                    />
                  </div>
                )}

                {/* Schedule mode */}
                {config.mode === "schedule" && (
                  <div className="space-y-3">
                    <label className="text-xs font-medium block">Scheduled Times (daily)</label>
                    <div className="flex items-end gap-2">
                      <Input
                        type="time"
                        value={newScheduleTime}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewScheduleTime(e.target.value)}
                        size="sm"
                        className="w-36"
                      />
                      <Button size="sm" variant="secondary" onClick={addScheduleTime}>
                        Add Time
                      </Button>
                    </div>
                    {(config.scheduleTimes ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(config.scheduleTimes ?? []).map((time) => (
                          <Badge key={time} variant="secondary" className="gap-1.5 pl-2.5 pr-1.5 py-1">
                            <Clock size={12} />
                            {time}
                            <button
                              onClick={() => removeScheduleTime(time)}
                              className="ml-0.5 hover:text-destructive transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {(config.scheduleTimes ?? []).length === 0 && (
                      <p className="text-xs text-muted-foreground">No times added yet. Add at least one time to enable scheduled checks.</p>
                    )}
                  </div>
                )}

                {/* Custom message templates */}
                <div className="space-y-3 border-t border-border pt-4">
                  <div>
                    <h4 className="text-xs font-semibold mb-1">Notification Messages</h4>
                    <p className="text-[11px] text-muted-foreground">
                      Available variables: <code className="bg-muted px-1 rounded">{"{domain}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{url}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{statusCode}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{responseTime}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{error}"}</code>{" "}
                      <code className="bg-muted px-1 rounded">{"{timestamp}"}</code>
                    </p>
                  </div>
                  <Textarea
                    label="Down message"
                    size="sm"
                    rows={2}
                    placeholder={DEFAULT_DOWN_TEMPLATE}
                    value={config.messageTemplate ?? ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setConfig({ ...config, messageTemplate: e.target.value || undefined })
                    }
                  />
                  <Textarea
                    label="Recovery message"
                    size="sm"
                    rows={2}
                    placeholder={DEFAULT_RECOVERY_TEMPLATE}
                    value={config.recoveryMessageTemplate ?? ""}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setConfig({ ...config, recoveryMessageTemplate: e.target.value || undefined })
                    }
                  />
                </div>

                {/* Save button */}
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveConfig} loading={configSaving}>
                    Save Schedule
                  </Button>
                </div>
              </>
            )}

            {/* Save when just toggling off */}
            {!config.enabled && (
              <div className="flex justify-end">
                <Button size="sm" variant="secondary" onClick={handleSaveConfig} loading={configSaving}>
                  Save
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add form */}
      {showAdd && (
        <Card>
          <CardContent className="space-y-4">
            {routes.length > 0 && (
              <SegmentController
                size="sm"
                options={[
                  { value: "manual", label: "Enter manually" },
                  { value: "routes", label: "Select from routes" },
                ]}
                value={addMode}
                onChange={(v) => setAddMode(v as "manual" | "routes")}
              />
            )}
            {addMode === "manual" ? (
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium mb-1 block">URL</label>
                  <Input
                    value={addUrl}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddUrl(e.target.value)}
                    placeholder="https://example.com"
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
                  />
                </div>
                <div className="sm:w-48">
                  <label className="text-xs font-medium mb-1 block">Name (optional)</label>
                  <Input
                    value={addName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddName(e.target.value)}
                    placeholder="My Service"
                    onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") handleAdd(); }}
                  />
                </div>
                <Button onClick={handleAdd} loading={adding} disabled={!addUrl.trim()} className="shrink-0">
                  Add
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {routes.filter((r) => r.enabled).flatMap((r) => r.domainNames).map((d) => {
                    const url = `https://${d}`;
                    const alreadyAdded = domains.some((dm) => dm.url === url);
                    const selected = selectedRouteDomains.has(d);
                    return (
                      <label key={d} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${alreadyAdded ? "opacity-40 pointer-events-none border-border" : selected ? "border-point bg-point/5" : "border-border hover:bg-surface-hover"}`}>
                        <input
                          type="checkbox"
                          checked={selected || alreadyAdded}
                          disabled={alreadyAdded}
                          onChange={() => setSelectedRouteDomains((prev) => {
                            const next = new Set(prev);
                            if (next.has(d)) next.delete(d); else next.add(d);
                            return next;
                          })}
                          className="rounded border-border"
                        />
                        <span className="text-sm font-mono">{d}</span>
                        {alreadyAdded && <span className="text-[10px] text-muted-foreground">Already added</span>}
                      </label>
                    );
                  })}
                </div>
                <Button
                  onClick={async () => {
                    if (selectedRouteDomains.size === 0) return;
                    setAdding(true);
                    let updated = domains;
                    for (const d of selectedRouteDomains) {
                      const res = await api.addHealthCheckDomain(`https://${d}`, d);
                      if (res.ok && res.data) updated = res.data;
                    }
                    setDomains(updated);
                    setSelectedRouteDomains(new Set());
                    toast(`Added ${selectedRouteDomains.size} domain(s)`, { variant: "success" });
                    runChecks(updated);
                    setAdding(false);
                  }}
                  loading={adding}
                  disabled={selectedRouteDomains.size === 0}
                >
                  Add Selected ({selectedRouteDomains.size})
                </Button>
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => { setShowAdd(false); setSelectedRouteDomains(new Set()); }}>
                Cancel
              </Button>
            </div>
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
                                result.statusCode < 300 ? "bg-[var(--success-bg)] text-[var(--success-fg)]"
                                : result.statusCode < 400 ? "bg-[var(--info-bg)] text-[var(--info-fg)]"
                                : result.statusCode < 500 ? "bg-[var(--warning-bg)] text-[var(--warning-fg)]"
                                : "bg-[var(--error-bg)] text-[var(--error-fg)]"
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
