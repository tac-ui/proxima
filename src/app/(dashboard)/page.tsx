"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useStacks } from "@/hooks/useStacks";
import { useRoutes } from "@/hooks/useRoutes";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
  EmptyState,
  Skeleton,
  pageEntrance,
  tacSpring,
} from "@tac-ui/web";
import { Layers, Globe, FolderGit2, BarChart3, ArrowRight } from "@tac-ui/icon";
import type { StackListItem, RepositoryInfo, HostAnalyticsSummary, ProxyHost } from "@/types";
import { statusVariantMap, statusLabelMap } from "@/lib/stack-constants";

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: tacSpring.entrance,
  },
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  href?: string;
  loading?: boolean;
}

function StatCard({ label, value, sub, icon, href, loading }: StatCardProps) {
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs sm:text-sm text-muted-foreground mb-1">{label}</p>
        <div className="text-2xl sm:text-3xl font-bold min-h-[36px] flex items-center">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <Skeleton height={32} width={80} className="rounded" />
              </motion.div>
            ) : (
              <motion.div key="value" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                {value}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="text-xs text-muted-foreground mt-1 min-h-[16px]">
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.div key="skeleton-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <Skeleton height={14} width={100} className="rounded-sm" />
              </motion.div>
            ) : (
              <motion.div key="sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
                {sub}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-point/10 text-point flex items-center justify-center shrink-0">
        {icon}
      </div>
    </div>
  );

  return (
    <Card interactive={!!href} className="h-full">
      <CardContent className="h-full">
        {href ? <Link href={href} className="flex flex-col h-full justify-start">{content}</Link> : content}
      </CardContent>
    </Card>
  );
}

function StackItem({ item }: { item: StackListItem }) {
  return (
    <Link
      href={`/stacks/${item.name}`}
      className="flex items-center justify-between py-3 border-b border-border last:border-0 hover:bg-surface-hover -mx-4 px-4 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-point/15 flex items-center justify-center shrink-0">
          <Layers size={14} className="text-point" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.containerCount} container{item.containerCount !== 1 ? "s" : ""}</p>
        </div>
      </div>
      <Badge variant={statusVariantMap[item.status] ?? "secondary"}>
        {statusLabelMap[item.status] ?? item.status}
      </Badge>
    </Link>
  );
}

function RouteItem({ route }: { route: ProxyHost }) {
  const domain = route.domainNames[0] ?? "—";
  const target = `${route.forwardScheme}://${route.forwardHost}:${route.forwardPort}`;
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{domain}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{target}</p>
      </div>
      <Badge variant={route.enabled ? "success" : "secondary"}>
        {route.enabled ? "Active" : "Disabled"}
      </Badge>
    </div>
  );
}

export default function DashboardPage() {
  const { stackList, loading: stacksLoading } = useStacks();
  const { routeList, loading: routesLoading } = useRoutes();
  const { connected } = useApiContext();
  const [repos, setRepos] = useState<RepositoryInfo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [trafficSummary, setTrafficSummary] = useState<HostAnalyticsSummary[]>([]);
  const [trafficLoading, setTrafficLoading] = useState(true);

  useEffect(() => {
    if (!connected) return;
    setTrafficLoading(true);
    setReposLoading(true);

    api.getAnalyticsSummary().then((res) => {
      if (res.ok && res.data) setTrafficSummary(res.data);
      setTrafficLoading(false);
    }).catch(() => setTrafficLoading(false));
    api.getRepos().then((res) => {
      if (res.ok && res.data) setRepos(res.data);
      setReposLoading(false);
    }).catch(() => setReposLoading(false));
  }, [connected]);

  const runningStacks = stackList.filter((s) => s.status === "running").length;
  const totalStacks = stackList.length;
  const recentStacks = [...stackList]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const activeRoutes = routeList.filter((r) => r.enabled);
  const recentRoutes = [...routeList].slice(0, 5);

  const totalTraffic24h = trafficSummary.reduce((sum, s) => sum + s.totalRequests, 0);

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Stats row */}
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={staggerItem} className="h-full">
          <StatCard
            label="Stacks"
            value={`${runningStacks} / ${totalStacks}`}
            sub={totalStacks === 0 ? "No stacks deployed" : `${runningStacks} running`}
            href="/stacks"
            icon={<Layers size={22} />}
            loading={stacksLoading}
          />
        </motion.div>
        <motion.div variants={staggerItem} className="h-full">
          <StatCard
            label="Routes"
            value={routeList.length}
            sub={`${activeRoutes.length} active`}
            href="/routes"
            icon={<Globe size={22} />}
            loading={routesLoading}
          />
        </motion.div>
        <motion.div variants={staggerItem} className="h-full">
          <StatCard
            label="Projects"
            value={repos.length}
            sub={repos.length === 0 ? "No projects cloned" : `${repos.reduce((sum, r) => sum + r.scripts.length, 0)} scripts`}
            href="/projects"
            icon={<FolderGit2 size={22} />}
            loading={reposLoading}
          />
        </motion.div>
        <motion.div variants={staggerItem} className="h-full">
          <StatCard
            label="Traffic (24h)"
            value={totalTraffic24h.toLocaleString()}
            sub={`${trafficSummary.length} host${trafficSummary.length !== 1 ? "s" : ""}`}
            href="/analytics"
            icon={<BarChart3 size={22} />}
            loading={trafficLoading}
          />
        </motion.div>
      </motion.div>

      {/* Bottom row: Recent Stacks + Active Routes */}
      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Recent Stacks */}
        <motion.div variants={staggerItem}>
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Recent Stacks</h2>
                <Link href="/stacks" className="flex items-center gap-1 text-xs text-point hover:text-point-hover transition-colors">
                  View all <ArrowRight size={12} />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {stacksLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-3 py-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} height={48} />
                    ))}
                  </motion.div>
                ) : recentStacks.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <EmptyState
                      icon={<Layers size={24} className="text-point" />}
                      title="No stacks deployed"
                      description="Deploy your first Docker Compose stack."
                      action={
                        <Link href="/stacks" className="text-sm text-point hover:text-point-hover transition-colors">
                          Go to Stacks
                        </Link>
                      }
                    />
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    {recentStacks.map((s) => (
                      <StackItem key={s.name} item={s} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>

        {/* Active Routes */}
        <motion.div variants={staggerItem}>
          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Routes</h2>
                <Link href="/routes" className="flex items-center gap-1 text-xs text-point hover:text-point-hover transition-colors">
                  View all <ArrowRight size={12} />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {routesLoading ? (
                  <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-3 py-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} height={48} />
                    ))}
                  </motion.div>
                ) : routeList.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <EmptyState
                      icon={<Globe size={24} className="text-point" />}
                      title="No routes configured"
                      description="Add a domain route to get started."
                      action={
                        <Link href="/routes/new" className="text-sm text-point hover:text-point-hover transition-colors">
                          Add Route
                        </Link>
                      }
                    />
                  </motion.div>
                ) : (
                  <motion.div key="list" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    {recentRoutes.map((r) => (
                      <RouteItem key={r.id} route={r} />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
