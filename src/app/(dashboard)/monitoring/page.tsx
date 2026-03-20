"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Skeleton,
  LineChart,
  SegmentController,
  pageEntrance,
} from "@tac-ui/web";
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from "@tac-ui/icon";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import type { SystemMetrics, MetricsHistoryPoint } from "@/types";

const POLL_INTERVAL = 30_000;

const HISTORY_OPTIONS = [
  { value: "1", label: "1h" },
  { value: "6", label: "6h" },
  { value: "24", label: "24h" },
];

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
      <div
        className="h-2.5 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatTimeLabel(ts: string, hours: number): string {
  const d = new Date(ts);
  if (hours <= 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function MonitoringPage() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [historyHours, setHistoryHours] = useState("1");
  const [historyPoints, setHistoryPoints] = useState<MetricsHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await api.getMetricsHistory(parseInt(historyHours, 10));
    if (res.ok && res.data) {
      setHistoryPoints(res.data.points);
    }
    setHistoryLoading(false);
  }, [historyHours]);

  // Initial load
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Load history when period changes
  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-poll every 30s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchMetrics(true);
      fetchHistory();
    }, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchMetrics, fetchHistory]);

  const hours = parseInt(historyHours, 10);

  const cpuChartData = historyPoints.map((p) => ({
    label: formatTimeLabel(p.timestamp, hours),
    value: Math.round(p.cpuLoad * 100) / 100,
  }));

  const memoryChartData = historyPoints.map((p) => ({
    label: formatTimeLabel(p.timestamp, hours),
    value: Math.round(p.memoryPercent * 10) / 10,
  }));

  const diskChartData = historyPoints.map((p) => ({
    label: formatTimeLabel(p.timestamp, hours),
    value: Math.round(p.diskPercent * 10) / 10,
  }));

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-point" />
          <h1 className="text-xl font-bold">System Monitoring</h1>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { fetchMetrics(true); fetchHistory(); }}
          loading={refreshing}
          leftIcon={refreshing ? undefined : <RefreshCw size={14} />}
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
        <>
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

          {/* History Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Resource History</h3>
              <SegmentController
                options={HISTORY_OPTIONS}
                value={historyHours}
                onChange={setHistoryHours}
                size="sm"
              />
            </div>

            {historyLoading && historyPoints.length === 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} height={220} />
                ))}
              </div>
            ) : historyPoints.length === 0 ? (
              <Card>
                <CardContent>
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No history data yet. Metrics are recorded every time this page refreshes (every 30s).
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Cpu size={14} className="text-point" />
                      <span className="text-sm font-semibold">CPU Load</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      data={cpuChartData}
                      height={180}
                      showGrid
                      showLabels
                      showDots={cpuChartData.length <= 30}
                      showArea
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <MemoryStick size={14} className="text-point" />
                      <span className="text-sm font-semibold">Memory %</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      data={memoryChartData}
                      height={180}
                      showGrid
                      showLabels
                      showDots={memoryChartData.length <= 30}
                      showArea
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <HardDrive size={14} className="text-point" />
                      <span className="text-sm font-semibold">Disk %</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <LineChart
                      data={diskChartData}
                      height={180}
                      showGrid
                      showLabels
                      showDots={diskChartData.length <= 30}
                      showArea
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </>
      ) : null}
    </motion.div>
  );
}
