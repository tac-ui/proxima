"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { AuditLog } from "@/types";
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Select,
  Skeleton,
  EmptyState,
  pageEntrance,
  fadeVariants,
  tacSpring,
  Indicator,
} from "@tac-ui/web";
import { ScrollText, ShieldAlert, ChevronLeft, ChevronRight } from "@tac-ui/icon";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "auth", label: "Auth" },
  { value: "user", label: "User" },
  { value: "stack", label: "Stack" },
  { value: "proxy", label: "Proxy" },
  { value: "settings", label: "Settings" },
  { value: "repo", label: "Repo" },
  { value: "ssh-key", label: "SSH Key" },
  { value: "terminal", label: "Terminal" },
];

const LIMIT = 50;

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.03 },
  },
};

const rowItem = {
  hidden: { opacity: 0, y: 6 },
  visible: {
    opacity: 1,
    y: 0,
    transition: tacSpring.entrance,
  },
};

function actionColorClass(action: string): string {
  switch (action) {
    case "login": return "text-success";
    case "login_failed": return "text-error";
    case "create": return "text-success";
    case "delete": return "text-error";
    case "update": return "text-warning";
    case "start": return "text-success";
    case "stop": return "text-warning";
    case "deploy": return "text-point";
    case "execute": return "text-point";
    default: return "text-muted-foreground";
  }
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    auth: "Auth",
    user: "User",
    stack: "Stack",
    proxy: "Proxy",
    settings: "Settings",
    repo: "Repo",
    "ssh-key": "SSH",
    terminal: "Terminal",
  };
  return map[cat] ?? cat;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditLogsPage() {
  const { isAdmin } = useAuth();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [loaded, setLoaded] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const loadLogs = useCallback(async () => {
    try {
      let startDate: string | undefined;
      let endDate: string | undefined;
      if (dateFilter) {
        startDate = `${dateFilter}T00:00:00.000Z`;
        endDate = `${dateFilter}T23:59:59.999Z`;
      }
      const res = await api.getAuditLogs({
        page,
        limit: LIMIT,
        category: category || undefined,
        startDate,
        endDate,
      });
      if (res.ok && res.data) {
        setLogs(res.data.logs);
        setTotal(res.data.total);
        setLoaded(true);
      }
    } catch {
      setLoaded(true);
    }
  }, [page, category, dateFilter]);

  useEffect(() => {
    if (isAdmin) loadLogs();
  }, [isAdmin, loadLogs]);

  if (!isAdmin) {
    return (
      <motion.div className="max-w-screen-md mx-auto" {...pageEntrance}>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldAlert size={48} className="text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">You don&apos;t have permission to view audit logs.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div className="max-w-screen-lg mx-auto space-y-6" {...pageEntrance}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
                <ScrollText size={18} className="text-point" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Audit Logs</h2>
                <p className="text-xs text-muted-foreground">Track user activity and system changes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); setPage(1); }}
                className="h-8 px-2 text-xs rounded-lg border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring"
              />
              <Select
                size="sm"
                options={CATEGORIES}
                value={category}
                onChange={(val) => { setCategory(val); setPage(1); }}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!loaded && <Indicator variant="linear" className="pb-4" />}

          <AnimatePresence mode="wait">
            {!loaded ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                className="space-y-2"
              >
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={52} className="rounded-lg" />
                ))}
              </motion.div>
            ) : logs.length === 0 ? (
              <motion.div
                key="empty"
                variants={fadeVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <EmptyState
                  icon={<ScrollText size={32} className="text-muted-foreground" />}
                  title="No audit logs"
                  description={category || dateFilter ? `No logs found for the selected filters.` : "No activity has been recorded yet."}
                />
              </motion.div>
            ) : (
              <motion.div
                key={`content-${page}-${category}-${dateFilter}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.2 } }}
                exit={{ opacity: 0 }}
              >
                <motion.div
                  className="divide-y divide-border"
                  variants={staggerContainer}
                  initial="hidden"
                  animate="visible"
                >
                  {logs.map((log) => (
                    <motion.div
                      key={log.id}
                      variants={rowItem}
                      className="flex items-start sm:items-center gap-3 py-3 px-1"
                    >
                      {/* Time */}
                      <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap shrink-0 pt-0.5 sm:pt-0 w-[140px] hidden sm:block">
                        {formatTime(log.createdAt)}
                      </span>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{log.username ?? "system"}</span>
                          <span className={`text-xs font-semibold ${actionColorClass(log.action)}`}>
                            {log.action}
                          </span>
                          <span className="text-xs text-muted-foreground">{categoryLabel(log.category)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {log.targetName && (
                            <span className="text-xs text-muted-foreground truncate">
                              {log.targetType && <span className="opacity-60">{log.targetType} </span>}
                              {log.targetName}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground font-mono sm:hidden">
                            {formatTime(log.createdAt)}
                          </span>
                        </div>
                      </div>

                      {/* IP */}
                      <span className="text-[11px] text-muted-foreground font-mono shrink-0 hidden md:block">
                        {log.ipAddress ?? "-"}
                      </span>
                    </motion.div>
                  ))}
                </motion.div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-4 border-t border-border mt-2">
                    <span className="text-xs text-muted-foreground">
                      {total.toLocaleString()} entries
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        leftIcon={<ChevronLeft size={14} />}
                      >
                        Prev
                      </Button>
                      <span className="text-xs text-muted-foreground px-2">
                        {page} / {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        leftIcon={<ChevronRight size={14} />}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
