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
  Modal,
  ModalHeader,
  ModalTitle,
  ModalFooter,
} from "@tac-ui/web";
import { Plus, RefreshCw, Trash2, HeartPulse, ExternalLink, Edit, Bell } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { useRouter } from "next/navigation";
import type { ProxyHost } from "@/types";

interface HealthDomain {
  url: string;
  name: string;
  addedAt: string;
  auto?: boolean;
  notifyEnabled?: boolean;
  messageTemplate?: string;
  recoveryMessageTemplate?: string;
  notificationChannelIds?: number[];
}

interface NotifChannel {
  id: number;
  type: string;
  name: string;
  enabled: boolean;
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
  const router = useRouter();

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
  const [routes, setRoutes] = useState<ProxyHost[]>([]);
  const [notifChannels, setNotifChannels] = useState<NotifChannel[]>([]);

  // Detail modal state
  const [detailDomain, setDetailDomain] = useState<HealthDomain | null>(null);
  const [detailNotifyEnabled, setDetailNotifyEnabled] = useState(true);
  const [detailDownTemplate, setDetailDownTemplate] = useState("");
  const [detailRecoveryTemplate, setDetailRecoveryTemplate] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailChannelIds, setDetailChannelIds] = useState<number[]>([]);
  const [detailName, setDetailName] = useState("");
  const [detailUrl, setDetailUrl] = useState("");

  const openDetail = (domain: HealthDomain) => {
    setDetailDomain(domain);
    setDetailName(domain.name);
    setDetailUrl(domain.url);
    setDetailNotifyEnabled(domain.notifyEnabled !== false);
    setDetailDownTemplate(domain.messageTemplate ?? "");
    setDetailRecoveryTemplate(domain.recoveryMessageTemplate ?? "");
    setDetailChannelIds(domain.notificationChannelIds ?? []);
  };

  const handleSaveDetail = async () => {
    if (!detailDomain) return;
    setDetailSaving(true);
    const data: Parameters<typeof api.updateHealthCheckDomain>[1] = {
      notifyEnabled: detailNotifyEnabled,
      messageTemplate: detailDownTemplate,
      recoveryMessageTemplate: detailRecoveryTemplate,
      notificationChannelIds: detailChannelIds,
    };
    if (detailName.trim() && detailName.trim() !== detailDomain.name) data.name = detailName.trim();
    if (detailUrl.trim() && detailUrl.trim() !== detailDomain.url) data.newUrl = detailUrl.trim();
    const res = await api.updateHealthCheckDomain(detailDomain.url, data);
    if (res.ok && res.data) {
      setDomains(res.data);
      toast("Notification settings saved", { variant: "success" });
      setDetailDomain(null);
    } else {
      toast(res.error ?? "Failed to save", { variant: "error" });
    }
    setDetailSaving(false);
  };

  // Schedule config state
  const [config, setConfig] = useState<HealthCheckConfig>({
    enabled: false,
    intervalMinutes: 5,
    mode: "interval",
  });

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
    const res = await api.getHealthCheckConfig();
    if (res.ok && res.data) setConfig(res.data);
  }, []);

  const fetchNotifChannels = useCallback(async () => {
    const res = await api.getNotificationChannels();
    if (res.ok && res.data) setNotifChannels(res.data.map((ch) => ({ id: ch.id, type: ch.type, name: ch.name, enabled: ch.enabled })));
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
    if (isManager) fetchNotifChannels();
  }, [fetchDomains, fetchRoutes, fetchConfig, isManager, fetchNotifChannels]);

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

  const saveConfig = async (updated: HealthCheckConfig) => {
    setConfig(updated);
    const res = await api.updateHealthCheckConfig(updated);
    if (res.ok && res.data) setConfig(res.data);
    else toast(res.error ?? "Failed to save config", { variant: "error" });
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
              {downCount > 0 && <span className="text-error font-medium">{downCount} down</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <div className="flex items-center gap-2 border border-border rounded-lg px-2.5 py-1">
              <Tooltip content={config.enabled ? "Auto-check enabled" : "Auto-check disabled"} placement="top">
                <Switch
                  checked={config.enabled}
                  onChange={(checked) => saveConfig({ ...config, enabled: checked })}
                  size="sm"
                />
              </Tooltip>
              {config.enabled && (
                <Select
                  size="sm"
                  options={INTERVAL_OPTIONS}
                  value={String(config.intervalMinutes)}
                  onChange={(v) => saveConfig({ ...config, intervalMinutes: Number(v) })}
                />
              )}
            </div>
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
            // Resolve channel names for this domain
            const activeChannels = domain.notifyEnabled !== false
              ? (domain.notificationChannelIds?.length
                  ? notifChannels.filter((ch) => domain.notificationChannelIds!.includes(ch.id) && ch.enabled)
                  : notifChannels.filter((ch) => ch.enabled))
              : [];

            return (
              <Card key={domain.url} className="cursor-pointer hover:border-foreground/20 transition-colors" onClick={() => openDetail(domain)}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4 min-w-0">
                    {/* Status indicator */}
                    <Tooltip content={isUp ? `${result.statusCode} OK` : isDown ? (result.error || `${result.statusCode}`) : "Checking..."} placement="top">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${isUp ? "bg-success" : isDown ? "bg-error" : "bg-muted-foreground animate-pulse"}`} />
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{domain.name}</span>
                        {domain.auto && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Auto</span>
                        )}
                        {result && (
                          <span className={`text-[11px] font-mono ${isUp ? "text-success" : "text-error"}`}>
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
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono truncate">
                          {domain.url}
                        </span>
                        {domain.notifyEnabled === false ? (
                          <span className="text-[10px] text-muted-foreground/50 shrink-0">Notifications off</span>
                        ) : activeChannels.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Bell size={10} className="text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground">
                              {domain.notificationChannelIds?.length
                                ? activeChannels.map((ch) => ch.name).join(", ")
                                : "All channels"}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {isManager && (
                    <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                      <Tooltip content="Edit" placement="top">
                        <Button variant="ghost" size="sm" iconOnly onClick={() => openDetail(domain)}>
                          <Edit size={14} />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Remove" placement="top">
                        <Button variant="ghost" size="sm" iconOnly onClick={() => handleRemove(domain.url, domain.name)}>
                          <Trash2 size={14} className="text-error" />
                        </Button>
                      </Tooltip>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {/* Detail modal */}
      <Modal open={!!detailDomain} onClose={() => setDetailDomain(null)} size="md">
        {detailDomain && (() => {
          const result = results[detailDomain.url];
          const isUp = result?.status === "up";
          const isDown = result?.status === "down";
          return (
            <>
              <ModalHeader>
                <ModalTitle>{detailDomain.name}</ModalTitle>
              </ModalHeader>
              <div className="px-6 pb-2 space-y-5">
                {/* Status section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isUp ? "bg-success" : isDown ? "bg-error" : "bg-muted-foreground animate-pulse"}`} />
                    <span className="text-sm font-medium">{isUp ? "Up" : isDown ? "Down" : "Checking..."}</span>
                    {result?.responseTime !== undefined && (
                      <span className={`text-xs font-mono ${isUp ? "text-success" : "text-error"}`}>
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
                    href={detailDomain.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-point transition-colors inline-flex items-center gap-1 font-mono"
                  >
                    {detailDomain.url}
                    <ExternalLink size={10} />
                  </a>
                  {result?.error && (
                    <p className="text-xs text-error bg-error/10 rounded-lg p-2">{result.error}</p>
                  )}
                </div>

                {/* Edit domain info */}
                {isManager && (
                  <div className="space-y-3 border-t border-border pt-4">
                    <Input
                      label="Name"
                      value={detailName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDetailName(e.target.value)}
                      size="sm"
                    />
                    <Input
                      label="URL"
                      value={detailUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDetailUrl(e.target.value)}
                      size="sm"
                    />
                  </div>
                )}

                {/* Notification settings */}
                {isManager && (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div className="flex items-center gap-3">
                      <Bell size={16} className="text-muted-foreground" />
                      <h3 className="text-sm font-semibold">Notification Settings</h3>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Enable Notifications</p>
                        <p className="text-xs text-muted-foreground">Send alerts when status changes</p>
                      </div>
                      <Switch
                        checked={detailNotifyEnabled}
                        onChange={setDetailNotifyEnabled}
                        size="sm"
                      />
                    </div>

                    {detailNotifyEnabled && notifChannels.length === 0 && (
                      <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-warning/30 bg-warning/5">
                        <div className="flex items-center gap-2 min-w-0">
                          <Bell size={14} className="text-warning shrink-0" />
                          <p className="text-xs text-warning">No notification channels registered.</p>
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => { setDetailDomain(null); router.push("/settings"); }} className="shrink-0">
                          Go to Settings
                        </Button>
                      </div>
                    )}

                    {detailNotifyEnabled && notifChannels.length > 0 && (
                      <div className="space-y-4">
                        {/* Channel selector */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Notification Channels</p>
                          <p className="text-xs text-muted-foreground">Select channels to receive alerts. Leave all unchecked to send to all channels.</p>
                          <div className="space-y-1.5">
                            {notifChannels.filter((ch) => ch.enabled).map((ch) => {
                              const selected = detailChannelIds.includes(ch.id);
                              return (
                                <label key={ch.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors cursor-pointer ${selected ? "border-point bg-point/5" : "border-border hover:bg-surface-hover"}`}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => setDetailChannelIds((prev) => selected ? prev.filter((id) => id !== ch.id) : [...prev, ch.id])}
                                    className="rounded border-border"
                                  />
                                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted">{ch.type === "slack" ? "Slack" : "Telegram"}</span>
                                  <span className="text-sm">{ch.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          {detailChannelIds.length === 0 && (
                            <p className="text-[11px] text-muted-foreground">All enabled channels will receive notifications.</p>
                          )}
                        </div>

                        {/* Custom message templates */}
                        <div className="space-y-3">
                          <p className="text-[11px] text-muted-foreground">
                            Custom templates override global defaults. Variables:{" "}
                            <code className="bg-muted px-1 rounded">{"{domain}"}</code>{" "}
                            <code className="bg-muted px-1 rounded">{"{statusCode}"}</code>{" "}
                            <code className="bg-muted px-1 rounded">{"{responseTime}"}</code>{" "}
                            <code className="bg-muted px-1 rounded">{"{error}"}</code>{" "}
                            <code className="bg-muted px-1 rounded">{"{timestamp}"}</code>
                          </p>
                          <Textarea
                            label="Down message"
                            size="sm"
                            rows={2}
                            placeholder={DEFAULT_DOWN_TEMPLATE}
                            value={detailDownTemplate}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDetailDownTemplate(e.target.value)}
                          />
                          <Textarea
                            label="Recovery message"
                            size="sm"
                            rows={2}
                            placeholder={DEFAULT_RECOVERY_TEMPLATE}
                            value={detailRecoveryTemplate}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDetailRecoveryTemplate(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <ModalFooter>
                <Button variant="secondary" onClick={() => setDetailDomain(null)}>Close</Button>
                {isManager && (
                  <Button onClick={handleSaveDetail} loading={detailSaving}>Save</Button>
                )}
              </ModalFooter>
            </>
          );
        })()}
      </Modal>
    </motion.div>
  );
}
