"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Input,
  Button,
  Badge,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { Cloud, ShieldAlert, Eye, EyeOff, Plus, Trash2, CheckCircle, Download, ChevronDown, ChevronRight, Play, Square, RotateCw, Circle, AlertCircle, Star } from "@tac-ui/icon";
import type { CloudflareZone } from "@/types";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";

const tunnelStatusVariantMap: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  running: "success",
  stopped: "destructive",
  error: "destructive",
  starting: "warning",
  restarting: "warning",
  not_found: "secondary",
};

const tunnelStatusLabelMap: Record<string, string> = {
  running: "Running",
  stopped: "Stopped",
  error: "Error",
  starting: "Starting...",
  restarting: "Restarting...",
  not_found: "Not Found",
};

export default function CloudflarePage() {
  const { isManager } = useAuth();
  const { toast } = useToast();

  // Tunnel state
  const [tunToken, setTunToken] = useState("");
  const [tunLoaded, setTunLoaded] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const [cfdState, setCfdState] = useState<"running" | "stopped" | "not_found" | "restarting" | "error" | "starting" | null>(null);
  const [cfdError, setCfdError] = useState<string | null>(null);
  const [cfdLogs, setCfdLogs] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [actionLoading, setActionLoading] = useState<"start" | "stop" | "restart" | null>(null);

  // Analytics state
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [cfDefaultZone, setCfDefaultZone] = useState("");
  const [newZoneId, setNewZoneId] = useState("");
  const [verifyingZone, setVerifyingZone] = useState(false);
  const [fetchingZones, setFetchingZones] = useState(false);
  const [cfLoaded, setCfLoaded] = useState(false);
  const [showTunToken, setShowTunToken] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [showRunningLogs, setShowRunningLogs] = useState(false);

  useEffect(() => {
    api.getCloudflareSettings().then((res) => {
      if (res.ok && res.data) {
        setCfApiToken(res.data.apiToken);
        setCfZones(res.data.zones ?? []);
        setCfDefaultZone(res.data.defaultZone ?? "");
        setCfLoaded(true);
      }
    }).catch(() => {});
    api.getTunnelSettings().then((res) => {
      if (res.ok && res.data) {
        setTunToken(res.data.tunnelToken);
        setTunLoaded(true);
      }
    }).catch(() => {});
    api.getCloudflaredStatus().then((res) => {
      if (res.ok && res.data) {
        setCfdState(res.data.state);
        setCfdError(res.data.error ?? null);
        setCfdLogs(res.data.logs ?? null);
      }
    }).catch(() => {});

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    let count = 0;
    pollingRef.current = setInterval(async () => {
      count++;
      try {
        const res = await api.getCloudflaredStatus();
        if (res.ok && res.data) {
          const { state, error, logs } = res.data;
          setCfdState(state);
          setCfdError(error ?? null);
          setCfdLogs(logs ?? null);
          if (state === "running" || state === "error" || state === "stopped") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch { /* ignore */ }
      if (count >= 15) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 2000);
  }, []);

  const handleTunnelAction = async (action: "start" | "stop" | "restart") => {
    setActionLoading(action);
    const res = await api.tunnelAction(action);
    setActionLoading(null);
    if (res.ok) {
      const pastTense: Record<string, string> = { start: "started", stop: "stopped", restart: "restarted" };
      toast(`Tunnel ${pastTense[action] ?? action}`, { variant: "success" });
      setCfdState(action === "stop" ? "stopped" : "starting");
      if (action !== "stop") startPolling();
    } else {
      toast(res.error ?? `${action} failed`, { variant: "error" });
    }
  };

  const handleSaveToken = async () => {
    setTokenSaving(true);
    try {
      const res = await api.updateTunnelSettings({
        enabled: true,
        tunnelToken: tunToken,
      });
      if (res.ok && res.data) {
        setTunToken(res.data.tunnelToken);
        toast("Token saved", { variant: "success" });
      } else {
        toast(res.error ?? "Failed to save token", { variant: "error" });
      }
    } catch {
      toast("Failed to save token", { variant: "error" });
    } finally {
      setTokenSaving(false);
    }
  };

  /** Auto-save zones settings */
  const saveZones = async (zones: CloudflareZone[], defaultZone: string) => {
    try {
      const cfRes = await api.updateCloudflareSettings({
        apiToken: cfApiToken,
        zones,
        autoSync: true,
        defaultZone,
      });
      if (cfRes.ok && cfRes.data) {
        setCfApiToken(cfRes.data.apiToken);
        setCfZones(cfRes.data.zones ?? []);
        setCfDefaultZone(cfRes.data.defaultZone ?? "");
      } else {
        toast(cfRes.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save zones", { variant: "error" });
    }
  };

  const handleSetDefaultZone = (zoneName: string) => {
    const newDefault = cfDefaultZone === zoneName ? "" : zoneName;
    setCfDefaultZone(newDefault);
    saveZones(cfZones, newDefault);
  };

  const handleAddZone = async () => {
    if (!newZoneId.trim()) return;
    setVerifyingZone(true);
    try {
      const res = await api.testCloudflareZone(newZoneId.trim(), cfApiToken);
      if (res.ok && res.data && res.data.valid) {
        const zone: CloudflareZone = { zoneId: newZoneId.trim(), zoneName: res.data.zoneName ?? "" };
        if (cfZones.some(z => z.zoneId === zone.zoneId)) {
          toast("Zone already added", { variant: "error" });
        } else {
          const newZones = [...cfZones, zone];
          setCfZones(newZones);
          setNewZoneId("");
          toast(`Zone "${zone.zoneName}" added`, { variant: "success" });
          saveZones(newZones, cfDefaultZone);
        }
      } else {
        toast(res.data?.error ?? res.error ?? "Invalid Zone ID", { variant: "error" });
      }
    } catch {
      toast("Failed to verify zone", { variant: "error" });
    } finally {
      setVerifyingZone(false);
    }
  };

  const handleRemoveZone = (zoneId: string) => {
    const removed = cfZones.find(z => z.zoneId === zoneId);
    const newZones = cfZones.filter(z => z.zoneId !== zoneId);
    setCfZones(newZones);
    const newDefault = removed && cfDefaultZone === removed.zoneName ? "" : cfDefaultZone;
    if (newDefault !== cfDefaultZone) setCfDefaultZone(newDefault);
    saveZones(newZones, newDefault);
  };

  const handleFetchZones = async () => {
    setFetchingZones(true);
    try {
      const res = await api.fetchCloudflareZones(cfApiToken);
      if (res.ok && res.data && Array.isArray(res.data)) {
        const newZones = res.data.filter(
          (z: CloudflareZone) => !cfZones.some(existing => existing.zoneId === z.zoneId)
        );
        if (newZones.length === 0) {
          toast(cfZones.length > 0 ? "No new zones found" : "No zones found for this API token", { variant: "info" });
        } else {
          const allZones = [...cfZones, ...newZones];
          setCfZones(allZones);
          toast(`Added ${newZones.length} zone(s)`, { variant: "success" });
          saveZones(allZones, cfDefaultZone);
        }
      } else {
        toast(res.error ?? "Failed to fetch zones", { variant: "error" });
      }
    } catch {
      toast("Failed to fetch zones", { variant: "error" });
    } finally {
      setFetchingZones(false);
    }
  };

  if (!isManager) {
    return (
      <motion.div className="max-w-screen-md mx-auto" {...pageEntrance}>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldAlert size={48} className="text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">You don&apos;t have permission to manage Cloudflare settings.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-screen-md mx-auto space-y-6"
      {...pageEntrance}
    >
      <LoadingIndicator visible={!tunLoaded || !cfLoaded} />

      {/* Setup Status */}
      {tunLoaded && cfLoaded && (
        <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
          <p className="text-sm font-semibold">Setup Status</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Tunnel Token */}
            <div className="flex items-start gap-2.5">
              {tunToken ? (
                <CheckCircle size={16} className="text-success shrink-0 mt-0.5" />
              ) : (
                <Circle size={16} className="text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-medium">Tunnel Token</p>
                <p className="text-[11px] text-muted-foreground">
                  {tunToken ? "Configured" : "Required for traffic routing"}
                </p>
              </div>
            </div>
            {/* API Token */}
            <div className="flex items-start gap-2.5">
              {cfApiToken ? (
                <CheckCircle size={16} className="text-success shrink-0 mt-0.5" />
              ) : (
                <Circle size={16} className="text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-medium">API Token</p>
                <p className="text-[11px] text-muted-foreground">
                  {cfApiToken ? "Configured" : "Required for DNS & ingress sync"}
                </p>
              </div>
            </div>
            {/* Connector */}
            <div className="flex items-start gap-2.5">
              {cfdState === "running" ? (
                <CheckCircle size={16} className="text-success shrink-0 mt-0.5" />
              ) : tunToken ? (
                <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" />
              ) : (
                <Circle size={16} className="text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-medium">Connector</p>
                <p className="text-[11px] text-muted-foreground">
                  {cfdState === "running" ? "Running" : tunToken ? "Not running — start below" : "Set tunnel token first"}
                </p>
              </div>
            </div>
          </div>
          {tunToken && cfApiToken && cfdState === "running" && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-success font-medium">All set — routes will auto-sync DNS records and tunnel ingress.</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  toast("Syncing all DNS records...", { variant: "info" });
                  const res = await api.syncAllDns();
                  if (res.ok && res.data) {
                    const { synced, failed } = res.data;
                    toast(`DNS sync complete: ${synced} synced${failed > 0 ? `, ${failed} failed` : ""}`, { variant: failed > 0 ? "warning" : "success" });
                  } else {
                    toast(res.error ?? "Sync failed", { variant: "error" });
                  }
                }}
              >
                Sync All DNS
              </Button>
            </div>
          )}
          {(!tunToken || !cfApiToken) && (
            <p className="text-xs text-muted-foreground">
              Both tokens are required for full automation. Without API Token, DNS and tunnel ingress must be configured manually in Cloudflare dashboard.
            </p>
          )}
        </div>
      )}

      {/* Cloudflare Tunnel */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <Cloud size={18} className="text-point" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Cloudflare Tunnel</h2>
                {cfdState && (
                  <Badge variant={tunnelStatusVariantMap[cfdState] ?? "secondary"}>
                    {tunnelStatusLabelMap[cfdState] ?? cfdState}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Route traffic through Cloudflare Tunnel</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {cfdState === "error" && (cfdError || cfdLogs) && (
              <div className="rounded-lg border border-error/20 bg-error/5 p-3 space-y-1">
                {cfdError && (
                  <p className="text-xs font-medium text-error">{cfdError}</p>
                )}
                {cfdLogs && (
                  <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono leading-relaxed">{cfdLogs}</pre>
                )}
              </div>
            )}
            {cfdState === "running" && cfdLogs && (
              <div className="rounded-lg border border-border bg-muted/30">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowRunningLogs((v) => !v)}
                >
                  {showRunningLogs ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Container Logs
                </button>
                {showRunningLogs && (
                  <pre className="px-3 pb-3 text-[11px] text-muted-foreground whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono leading-relaxed">{cfdLogs}</pre>
                )}
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tunnel Token</label>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Networks &gt; Tunnels</span> &gt; Select tunnel &gt; Configure &gt; Copy token
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showTunToken ? "text" : "password"}
                    value={tunToken}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTunToken(e.target.value)}
                    placeholder="eyJhIjoiNmI..."
                  />
                  <button
                    type="button"
                    aria-label="Toggle visibility"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowTunToken((v) => !v)}
                  >
                    {showTunToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API Token</label>
              <p className="text-xs text-muted-foreground">
                Required permissions: <span className="font-medium">Cloudflare Tunnel:Edit</span>, <span className="font-medium">DNS:Edit</span>, <span className="font-medium">Analytics:Read</span>
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showApiToken ? "text" : "password"}
                    value={cfApiToken}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfApiToken(e.target.value)}
                    placeholder="Cloudflare API Token"
                  />
                  <button
                    type="button"
                    aria-label="Toggle visibility"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowApiToken((v) => !v)}
                  >
                    {showApiToken ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                disabled={tokenSaving || actionLoading !== null || !tunLoaded || !cfLoaded}
                onClick={async () => {
                  setTokenSaving(true);
                  try {
                    const [tunRes, cfRes] = await Promise.all([
                      api.updateTunnelSettings({ enabled: true, tunnelToken: tunToken }),
                      api.updateCloudflareSettings({ apiToken: cfApiToken, zones: cfZones, autoSync: true, defaultZone: cfDefaultZone }),
                    ]);
                    if (tunRes.ok && tunRes.data) setTunToken(tunRes.data.tunnelToken);
                    if (cfRes.ok && cfRes.data) { setCfApiToken(cfRes.data.apiToken); setCfZones(cfRes.data.zones ?? []); }
                    if (tunRes.ok && cfRes.ok) toast("Tokens saved", { variant: "success" });
                    else toast("Some settings failed to save", { variant: "warning" });
                  } catch {
                    toast("Failed to save tokens", { variant: "error" });
                  } finally {
                    setTokenSaving(false);
                  }
                }}
              >
                {tokenSaving ? "Saving..." : "Save Tokens"}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || cfdState === "running" || cfdState === "starting" || cfdState === "restarting"}
                onClick={() => handleTunnelAction("start")}
                loading={actionLoading === "start"}
                leftIcon={actionLoading === "start" ? undefined : <Play size={14} />}
              >
                {actionLoading === "start" ? "Starting..." : "Start"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || (cfdState !== "running" && cfdState !== "starting" && cfdState !== "restarting")}
                onClick={() => handleTunnelAction("stop")}
                loading={actionLoading === "stop"}
                leftIcon={actionLoading === "stop" ? undefined : <Square size={14} />}
              >
                {actionLoading === "stop" ? "Stopping..." : "Stop"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || cfdState !== "running"}
                onClick={() => handleTunnelAction("restart")}
                loading={actionLoading === "restart"}
                leftIcon={actionLoading === "restart" ? undefined : <RotateCw size={14} />}
              >
                {actionLoading === "restart" ? "Restarting..." : "Restart"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Zones */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
              <Cloud size={18} className="text-info" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Zones</h2>
              <p className="text-xs text-muted-foreground">Manage Cloudflare zones for DNS sync and analytics</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Zones list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground">Zones</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!cfApiToken}
                  onClick={handleFetchZones}
                  loading={fetchingZones}
                  leftIcon={fetchingZones ? undefined : <Download size={13} />}
                >
                  <span className="text-xs">Fetch Zones</span>
                </Button>
              </div>
              {cfZones.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {cfZones.map((zone) => {
                    const isDefault = cfDefaultZone === zone.zoneName;
                    return (
                      <div key={zone.zoneId} className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors ${isDefault ? "border-point/30 bg-point/5" : "bg-muted/30"}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle size={14} className="text-success shrink-0" />
                          <span className="text-sm truncate">
                            {zone.zoneName ? (
                              <>{zone.zoneName} <span className="text-muted-foreground text-xs">({zone.zoneId})</span></>
                            ) : (
                              <span className="text-muted-foreground">{zone.zoneId}</span>
                            )}
                          </span>
                          {isDefault && <Badge variant="secondary">Default</Badge>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={() => handleSetDefaultZone(zone.zoneName)}
                            className={`transition-colors p-1 rounded ${isDefault ? "text-point" : "text-muted-foreground/40 hover:text-point"}`}
                            title={isDefault ? "Remove as default" : "Set as default domain"}
                          >
                            <Star size={14} fill={isDefault ? "currentColor" : "none"} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveZone(zone.zoneId)}
                            className="text-muted-foreground hover:text-error transition-colors p-1 rounded"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">No zones configured</p>
              )}

              {/* Add zone */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    value={newZoneId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewZoneId(e.target.value)}
                    placeholder="Zone ID from Cloudflare dashboard"
                    onKeyDown={(e: React.KeyboardEvent) => e.key === "Enter" && handleAddZone()}
                  />
                </div>
                <Button
                  variant="secondary"
                  disabled={!newZoneId.trim() || !cfApiToken}
                  onClick={handleAddZone}
                  loading={verifyingZone}
                  leftIcon={verifyingZone ? undefined : <Plus size={14} />}
                >
                  Add
                </Button>
              </div>
            </div>

          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
