"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Switch,
  Input,
  Button,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { Cloud, ShieldAlert } from "@tac-ui/icon";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";

export default function CloudflarePage() {
  const { isManager } = useAuth();
  const { toast } = useToast();

  // Tunnel state
  const [tunEnabled, setTunEnabled] = useState(false);
  const [tunToken, setTunToken] = useState("");
  const [tunLoaded, setTunLoaded] = useState(false);
  const [cfdState, setCfdState] = useState<"running" | "stopped" | "not_found" | null>(null);

  // Analytics state
  const [cfAutoSync, setCfAutoSync] = useState(false);
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");
  const [cfLoaded, setCfLoaded] = useState(false);
  const [cfSaving, setCfSaving] = useState(false);
  const [cfTesting, setCfTesting] = useState(false);
  const [cfTestResult, setCfTestResult] = useState<{ valid: boolean; zoneName?: string; error?: string } | null>(null);

  useEffect(() => {
    api.getCloudflareSettings().then((res) => {
      if (res.ok && res.data) {
        setCfAutoSync(res.data.autoSync);
        setCfApiToken(res.data.apiToken);
        setCfZoneId(res.data.zoneId);
        setCfLoaded(true);
      }
    }).catch(() => {});
    api.getTunnelSettings().then((res) => {
      if (res.ok && res.data) {
        setTunEnabled(res.data.enabled);
        setTunToken(res.data.tunnelToken);
        setTunLoaded(true);
      }
    }).catch(() => {});
    api.getCloudflaredStatus().then((res) => {
      if (res.ok && res.data) setCfdState(res.data.state);
    }).catch(() => {});
  }, []);

  const handleSaveTunnel = async () => {
    setCfSaving(true);
    try {
      const tunRes = await api.updateTunnelSettings({
        enabled: tunEnabled,
        tunnelToken: tunToken,
      });
      if (tunRes.ok && tunRes.data) {
        setTunToken(tunRes.data.tunnelToken);
        toast("Tunnel settings saved", { variant: "success" });
        api.getCloudflaredStatus().then((res) => {
          if (res.ok && res.data) setCfdState(res.data.state);
        }).catch(() => {});
      } else {
        toast(tunRes.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save tunnel settings", { variant: "error" });
    } finally {
      setCfSaving(false);
    }
  };

  const handleSaveCloudflare = async () => {
    setCfSaving(true);
    try {
      const cfRes = await api.updateCloudflareSettings({
        apiToken: cfApiToken,
        zoneId: cfZoneId,
        autoSync: cfAutoSync,
      });
      if (cfRes.ok && cfRes.data) {
        setCfApiToken(cfRes.data.apiToken);
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

  const handleTestCloudflare = async () => {
    setCfTesting(true);
    setCfTestResult(null);
    try {
      const res = await api.testCloudflareConnection();
      if (res.ok && res.data) {
        setCfTestResult(res.data);
      } else {
        setCfTestResult({ valid: false, error: res.error ?? "Test failed" });
      }
    } catch {
      setCfTestResult({ valid: false, error: "Connection failed" });
    } finally {
      setCfTesting(false);
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
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                    cfdState === "running"
                      ? "bg-success/15 text-success"
                      : cfdState === "stopped"
                        ? "bg-error/15 text-error"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      cfdState === "running" ? "bg-success" : cfdState === "stopped" ? "bg-error" : "bg-muted-foreground"
                    }`} />
                    {cfdState === "running" ? "Running" : cfdState === "stopped" ? "Stopped" : "Not Found"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Route traffic through Cloudflare Tunnel</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable Tunnel</p>
                <p className="text-xs text-muted-foreground">Route all traffic through Cloudflare Tunnel</p>
              </div>
              <Switch
                checked={tunEnabled}
                onChange={() => setTunEnabled(prev => !prev)}
              />
            </div>
            <Input
              label="Tunnel Token"
              type="password"
              value={tunToken}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTunToken(e.target.value)}
              placeholder="Tunnel token from Cloudflare dashboard"
            />
            <p className="text-xs text-muted-foreground">
              Get the token from Cloudflare Zero Trust &gt; Networks &gt; Tunnels &gt; Configure &gt; Install connector.
            </p>
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={cfSaving || !tunLoaded}
                onClick={handleSaveTunnel}
              >
                {cfSaving ? "Saving..." : "Save"}
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
            <Input
              label="API Token"
              type="password"
              value={cfApiToken}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfApiToken(e.target.value)}
              placeholder="Cloudflare API Token"
            />
            <Input
              label="Zone ID"
              value={cfZoneId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCfZoneId(e.target.value)}
              placeholder="Zone ID from Cloudflare dashboard"
            />
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={cfTesting || !cfApiToken || !cfZoneId}
                onClick={handleTestCloudflare}
              >
                {cfTesting ? "Testing..." : "Test Connection"}
              </Button>
              {cfTestResult && (
                <span className={`text-xs font-medium ${cfTestResult.valid ? "text-success" : "text-error"}`}>
                  {cfTestResult.valid ? `Connected to ${cfTestResult.zoneName}` : cfTestResult.error}
                </span>
              )}
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
