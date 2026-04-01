"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import { useRoutes } from "@/hooks/useRoutes";
import { useApiContext } from "@/contexts/ApiContext";
import {
  Card,
  CardHeader,
  CardContent,
  Skeleton,
  EmptyState,
  LineChart,
  DonutChart,
  SegmentController,
  Select,
  Button,
  Indicator,
  pageEntrance,
  tacSpring,
} from "@tac-ui/web";
import { BarChart3, AlertTriangle, ArrowUpRight, Globe } from "@tac-ui/icon";
import type { AnalyticsData, HostAnalyticsSummary } from "@/types";

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07 } },
};

const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: tacSpring.entrance },
};

const PERIOD_OPTIONS = [
  { value: "24", label: "24h" },
  { value: "168", label: "7d" },
  { value: "720", label: "30d" },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function StatCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl sm:text-3xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-point/10 text-point flex items-center justify-center shrink-0">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<Skeleton height={400} />}>
      <AnalyticsContent />
    </Suspense>
  );
}

function AnalyticsContent() {
  const searchParams = useSearchParams();
  const initialHostId = searchParams.get("hostId");

  const { connected } = useApiContext();
  const { routeList } = useRoutes();

  const [selectedHostId, setSelectedHostId] = useState<number | null>(
    initialHostId ? parseInt(initialHostId, 10) : null,
  );
  const [hours, setHours] = useState("24");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [summaries, setSummaries] = useState<HostAnalyticsSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Load summaries
  useEffect(() => {
    if (!connected) return;
    api.getAnalyticsSummary().then((res) => {
      if (res.ok && res.data) setSummaries(res.data);
    });
  }, [connected]);

  // Auto-select first host if none selected
  useEffect(() => {
    if (selectedHostId === null && routeList.length > 0) {
      setSelectedHostId(routeList[0].id);
    }
  }, [routeList, selectedHostId]);

  // Load host analytics
  const loadAnalytics = useCallback(async () => {
    if (!selectedHostId || !connected) {
      setLoading(false);
      setAnalytics(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getAnalytics(selectedHostId, parseInt(hours, 10));
      if (res.ok && res.data) {
        setAnalytics(res.data);
      } else {
        setAnalytics(null);
      }
    } catch {
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [selectedHostId, hours, connected]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Find the host with the most traffic
  const topHost = summaries.reduce<HostAnalyticsSummary | null>(
    (best, s) => (!best || s.totalRequests > best.totalRequests ? s : best),
    null,
  );
  const topHostName = topHost
    ? routeList.find((p) => p.id === topHost.proxyHostId)?.domainNames[0] ?? `Host #${topHost.proxyHostId}`
    : "-";

  const total24h = summaries.reduce((sum, s) => sum + s.totalRequests, 0);
  const totalErrors24h = summaries.reduce(
    (sum, s) => sum + Math.round((s.errorRate / 100) * s.totalRequests),
    0,
  );
  const overallErrorRate = total24h > 0 ? Math.round((totalErrors24h / total24h) * 100 * 100) / 100 : 0;

  // Chart data
  const trafficChartData = (analytics?.buckets ?? []).map((b) => ({
    label: new Date(b.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    value: b.totalRequests,
  }));

  const statusChartData = analytics
    ? [
        { label: "2xx", value: analytics.summary.status2xx, color: "var(--color-success)" },
        { label: "3xx", value: analytics.summary.status3xx, color: "var(--color-info)" },
        { label: "4xx", value: analytics.summary.status4xx, color: "var(--color-warning)" },
        { label: "5xx", value: analytics.summary.status5xx, color: "var(--color-error)" },
      ].filter((d) => d.value > 0)
    : [];

  const selectedHost = routeList.find((p) => p.id === selectedHostId);

  if (routeList.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <EmptyState
          icon={<Globe size={32} className="text-point" />}
          title="No Routes"
          description="Add a route to start collecting analytics."
          action={
            <Link href="/routes">
              <Button>Go to Routes</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {loading && <Indicator variant="linear" />}

      {/* Summary cards */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem}>
          <StatCard
            label="Requests (24h)"
            value={total24h.toLocaleString()}
            sub={`${summaries.length} host${summaries.length !== 1 ? "s" : ""} with traffic`}
            icon={<BarChart3 size={22} />}
          />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard
            label="Error Rate (24h)"
            value={`${overallErrorRate}%`}
            sub={`${totalErrors24h.toLocaleString()} errors`}
            icon={<AlertTriangle size={22} />}
          />
        </motion.div>
        <motion.div variants={staggerItem}>
          <StatCard
            label="Top Host"
            value={topHostName}
            sub={topHost ? `${topHost.totalRequests.toLocaleString()} requests` : "No data"}
            icon={<ArrowUpRight size={22} />}
          />
        </motion.div>
      </motion.div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <Select
          size="sm"
          value={selectedHostId !== null ? String(selectedHostId) : ""}
          options={routeList.map((h) => ({ value: String(h.id), label: h.domainNames.join(", ") }))}
          onChange={(val) => setSelectedHostId(parseInt(val, 10))}
        />

        <SegmentController
          options={PERIOD_OPTIONS}
          value={hours}
          onChange={setHours}
          size="sm"
        />
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton height={300} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton height={200} />
            <Skeleton height={200} />
          </div>
        </div>
      ) : !analytics || analytics.summary.totalRequests === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<BarChart3 size={24} className="text-point" />}
              title="No analytics data"
              description={
                selectedHost
                  ? `No traffic recorded for ${selectedHost.domainNames.join(", ")} in the selected period.`
                  : "Select a route to view analytics."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Host summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent>
                <p className="text-xs text-muted-foreground">Total Requests</p>
                <p className="text-xl sm:text-2xl font-bold">{analytics.summary.totalRequests.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs text-muted-foreground">Unique Visitors</p>
                <p className="text-xl sm:text-2xl font-bold">{analytics.summary.uniqueVisitors.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs text-muted-foreground">Error Rate</p>
                <p className="text-xl sm:text-2xl font-bold">{analytics.summary.errorRate}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-xs text-muted-foreground">Bandwidth</p>
                <p className="text-xl sm:text-2xl font-bold">{formatBytes(analytics.summary.bytesSent)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold">Traffic Over Time</h2>
                </CardHeader>
                <CardContent>
                  <LineChart
                    data={trafficChartData}
                    height={280}
                    showGrid
                    showLabels
                    showDots={trafficChartData.length <= 48}
                    showArea
                  />
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold">Status Codes</h2>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-center">
                    <DonutChart
                      data={statusChartData}
                      size={200}
                      showLabels
                      showValues
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top Paths */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold">Top Paths</h2>
              </CardHeader>
              <CardContent>
                {analytics.topPaths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : (
                  <div className="space-y-1">
                    {analytics.topPaths.slice(0, 10).map((p) => (
                      <div key={p.path} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <span className="text-sm font-mono truncate mr-3">{p.path}</span>
                        <span className="text-sm text-muted-foreground shrink-0">{p.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top Referrers */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold">Top Referrers</h2>
              </CardHeader>
              <CardContent>
                {analytics.topReferrers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No referrer data</p>
                ) : (
                  <div className="space-y-1">
                    {analytics.topReferrers.slice(0, 10).map((r) => (
                      <div key={r.referrer} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <span className="text-sm truncate mr-3">{r.referrer}</span>
                        <span className="text-sm text-muted-foreground shrink-0">{r.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </motion.div>
  );
}
