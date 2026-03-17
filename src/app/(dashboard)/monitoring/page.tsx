"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Skeleton,
  pageEntrance,
} from "@tac-ui/web";
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from "@tac-ui/icon";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import type { SystemMetrics } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function UsageBar({ percent, label }: { percent: number; label: string }) {
  const color =
    percent >= 90
      ? "bg-destructive"
      : percent >= 70
        ? "bg-warning"
        : "bg-point";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    const res = await api.getSystemMetrics();
    if (res.ok && res.data) {
      setMetrics(res.data);
    }

    if (isRefresh) setRefreshing(false);
    else setLoading(false);
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-point" />
          <h2 className="text-lg font-bold">System Monitoring</h2>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fetchMetrics(true)}
          disabled={refreshing}
          leftIcon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
        >
          Refresh
        </Button>
      </div>

      <LoadingIndicator visible={loading} />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={180} />
          ))}
        </div>
      ) : metrics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* CPU Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-point" />
                <span className="font-semibold text-sm">CPU</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Model</span>
                  <span className="font-mono text-xs text-right max-w-[60%] truncate" title={metrics.cpu.model}>
                    {metrics.cpu.model}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cores</span>
                  <span className="font-mono font-semibold">{metrics.cpu.cores}</span>
                </div>
              </div>
              <div className="border-t border-border pt-3 space-y-1.5">
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Load Average</span>
                <div className="grid grid-cols-3 gap-2">
                  {(["1m", "5m", "15m"] as const).map((label, i) => (
                    <div key={label} className="text-center rounded-lg bg-muted/50 py-2">
                      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
                      <div className="font-mono font-semibold text-sm">{metrics.cpu.loadAvg[i].toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Memory Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MemoryStick size={16} className="text-point" />
                <span className="font-semibold text-sm">Memory</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <UsageBar percent={metrics.memory.usagePercent} label="Usage" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Total</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.memory.totalBytes)}</div>
                </div>
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Used</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.memory.usedBytes)}</div>
                </div>
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Free</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.memory.freeBytes)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Disk Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <HardDrive size={16} className="text-point" />
                <span className="font-semibold text-sm">Disk</span>
                <span className="text-xs text-muted-foreground font-mono ml-auto">{metrics.disk.mountPoint}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <UsageBar percent={metrics.disk.usagePercent} label="Usage" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Total</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.disk.totalBytes)}</div>
                </div>
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Used</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.disk.usedBytes)}</div>
                </div>
                <div className="text-center rounded-lg bg-muted/50 py-2">
                  <div className="text-[10px] text-muted-foreground uppercase">Available</div>
                  <div className="font-mono font-semibold text-sm">{formatBytes(metrics.disk.availableBytes)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* System Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server size={16} className="text-point" />
                <span className="font-semibold text-sm">System Info</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Hostname", value: metrics.os.hostname },
                { label: "OS", value: `${metrics.os.type} (${metrics.os.platform})` },
                { label: "Kernel", value: metrics.os.release },
                { label: "Architecture", value: metrics.os.arch },
                { label: "Uptime", value: metrics.uptime.formatted },
              ].map((row) => (
                <div key={row.label} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="font-mono text-xs text-right max-w-[60%] truncate" title={row.value}>
                    {row.value}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </motion.div>
  );
}
