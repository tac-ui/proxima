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
import { Cloud, ShieldAlert, Eye, EyeOff, Plus, Trash2, CheckCircle, Loader2, Download, ChevronDown, ChevronRight, Play, Square, RotateCw } from "@tac-ui/icon";
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
  const [cfAutoSync, setCfAutoSync] = useState(false);
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [newZoneId, setNewZoneId] = useState("");
  const [verifyingZone, setVerifyingZone] = useState(false);
  const [fetchingZones, setFetchingZones] = useState(false);
  const [cfLoaded, setCfLoaded] = useState(false);
  const [cfSaving, setCfSaving] = useState(false);
  const [showTunToken, setShowTunToken] = useState(false);
  const [showApiToken, setShowApiToken] = useState(false);
  const [showRunningLogs, setShowRunningLogs] = useState(false);

  useEffect(() => {
    api.getCloudflareSettings().then((res) => {
      if (res.ok && res.data) {
        setCfAutoSync(res.data.autoSync);
        setCfApiToken(res.data.apiToken);
        setCfZones(res.data.zones ?? []);
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
      toast(`Tunnel ${action}ed`, { variant: "success" });
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

  const handleSaveCloudflare = async () => {
    setCfSaving(true);
    try {
      const cfRes = await api.updateCloudflareSettings({
        apiToken: cfApiToken,
        zones: cfZones,
        autoSync: cfAutoSync,
      });
      if (cfRes.ok && cfRes.data) {
        setCfApiToken(cfRes.data.apiToken);
        setCfZones(cfRes.data.zones ?? []);
        toast("Analytics settings saved", { variant: "success" });
      } else {
        toast(cfRes.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save analytics settings", { variant: "error" });
    } finally {
      setCfSaving(false);
    }
  };

  const handleAddZone = async () => {
    if (!newZoneId.trim()) return;
    setVerifyingZone(true);
    try {
      const res = await api.testCloudflareZone(newZoneId.trim(), cfApiToken);
      if (res.ok && res.data && res.data.valid) {
        const zone: CloudflareZone = { zoneId: newZoneId.trim(), zoneName: res.data.zoneName ?? "" };
        // Avoid duplicates
        if (cfZones.some(z => z.zoneId === zone.zoneId)) {
          toast("Zone already added", { variant: "error" });
        } else {
          setCfZones(prev => [...prev, zone]);
          setNewZoneId("");
          toast(`Zone "${zone.zoneName}" added`, { variant: "success" });
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
    setCfZones(prev => prev.filter(z => z.zoneId !== zoneId));
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
          setCfZones(prev => [...prev, ...newZones]);
          toast(`Added ${newZones.length} zone(s)`, { variant: "success" });
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
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  label="Tunnel Token"
                  type={showTunToken ? "text" : "password"}
                  value={tunToken}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTunToken(e.target.value)}
                  placeholder="Tunnel token from Cloudflare dashboard"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-[50%] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowTunToken((v) => !v)}
                  tabIndex={-1}
                >
                  {showTunToken ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || !tunLoaded}
                onClick={handleSaveToken}
              >
                {tokenSaving ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get the token from Cloudflare | Networks &gt; Tunnels
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || cfdState === "running" || cfdState === "starting" || cfdState === "restarting"}
                onClick={() => handleTunnelAction("start")}
                leftIcon={actionLoading === "start" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              >
                {actionLoading === "start" ? "Starting..." : "Start"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || (cfdState !== "running" && cfdState !== "starting" && cfdState !== "restarting")}
                onClick={() => handleTunnelAction("stop")}
                leftIcon={actionLoading === "stop" ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              >
                {actionLoading === "stop" ? "Stopping..." : "Stop"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={tokenSaving || actionLoading !== null || cfdState !== "running"}
                onClick={() => handleTunnelAction("restart")}
                leftIcon={actionLoading === "restart" ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
              >
                {actionLoading === "restart" ? "Restarting..." : "Restart"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cloudflare Analytics API */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-info/15 flex items-center justify-center">
              <Cloud size={18} className="text-info" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Cloudflare Analytics</h2>
              <p className="text-xs text-muted-foreground">API credentials for traffic analytics</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="relative">
              <Input
                label="API Token"
                type={showApiToken ? "text" : "password"}
                value={cfApiToken}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfApiToken(e.target.value)}
                placeholder="Cloudflare API Token"
              />
              <button
                type="button"
                className="absolute right-2.5 top-[50%] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowApiToken((v) => !v)}
                tabIndex={-1}
              >
                {showApiToken ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Zones list */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-foreground">Zones</p>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={fetchingZones || !cfApiToken}
                  onClick={handleFetchZones}
                >
                  {fetchingZones ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span className="ml-1 text-xs">Fetch Zones</span>
                </Button>
              </div>
              {cfZones.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {cfZones.map((zone) => (
                    <div key={zone.zoneId} className="flex items-center justify-between px-3 py-2 rounded-lg border bg-muted/30">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle size={14} className="text-success shrink-0" />
                        <span className="text-sm truncate">
                          {zone.zoneName ? (
                            <>{zone.zoneName} <span className="text-muted-foreground text-xs">({zone.zoneId})</span></>
                          ) : (
                            <span className="text-muted-foreground">{zone.zoneId}</span>
                          )}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveZone(zone.zoneId)}
                        className="text-muted-foreground hover:text-error transition-colors shrink-0 ml-2"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
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
                  disabled={verifyingZone || !newZoneId.trim() || !cfApiToken}
                  onClick={handleAddZone}
                >
                  {verifyingZone ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  <span className="ml-1">Add</span>
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={cfSaving || !cfLoaded}
                onClick={handleSaveCloudflare}
              >
                {cfSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
