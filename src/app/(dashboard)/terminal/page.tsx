"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/contexts/AuthContext";
import { EmptyState, Button, pageEntrance, useToast } from "@tac-ui/web";
import { Plus, X, SquareTerminal, Circle } from "@tac-ui/icon";

const Terminal = dynamic(
  () => import("@/components/terminal/Terminal").then((m) => m.Terminal),
  { ssr: false },
);

interface ShellTab {
  id: string;
  connected: boolean;
}

export default function TerminalPage() {
  const [tabs, setTabs] = useState<ShellTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const confirm = useConfirm();
  const { toast } = useToast();
  const { isManager } = useAuth();
  const exitTimers = useRef<Record<string, NodeJS.Timeout>>({});

  // Load existing shell sessions
  useEffect(() => {
    api.getActiveTerminals().then((res) => {
      if (res.ok && res.data) {
        const shellTabs = res.data
          .filter((t) => t.id.startsWith("shell-"))
          .map((t) => ({ id: t.id, connected: false }));
        setTabs(shellTabs);
        if (shellTabs.length > 0) {
          setActiveTab(shellTabs[shellTabs.length - 1].id);
        }
      }
    });
  }, []);

  const createTab = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.createShellTerminal();
      if (res.ok && res.data) {
        const newTab = { id: res.data.terminalId, connected: false };
        setTabs((prev) => [...prev, newTab]);
        setActiveTab(res.data.terminalId);
      } else {
        toast(res.error ?? "Failed to create terminal", { variant: "error" });
      }
    } catch {
      toast("Failed to create terminal session", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const closeTab = useCallback(
    async (id: string) => {
      const confirmed = await confirm({
        title: "Close Terminal",
        message: "Are you sure you want to close this terminal session?",
        confirmLabel: "Close",
        variant: "destructive",
      });
      if (!confirmed) return;

      await api.killTerminal(id);

      if (exitTimers.current[id]) {
        clearTimeout(exitTimers.current[id]);
        delete exitTimers.current[id];
      }

      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        setActiveTab((current) =>
          current === id
            ? next.length > 0
              ? next[next.length - 1].id
              : null
            : current,
        );
        return next;
      });
    },
    [confirm],
  );

  const handleExit = useCallback((id: string) => {
    exitTimers.current[id] = setTimeout(() => {
      delete exitTimers.current[id];
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id);
        setActiveTab((current) =>
          current === id
            ? next.length > 0
              ? next[next.length - 1].id
              : null
            : current,
        );
        return next;
      });
    }, 2000);
  }, []);

  const handleConnectionChange = useCallback((id: string, connected: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, connected } : t)),
    );
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(exitTimers.current)) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <motion.div className="flex flex-col h-full" {...pageEntrance}>
      <div className="flex flex-col h-full rounded-xl border border-border bg-background overflow-hidden shadow-sm">
        {/* Header / Tab Bar */}
        <div className="flex items-center shrink-0 bg-surface border-b border-border">
          <div className="flex items-center gap-2 px-4 py-2.5 shrink-0 border-r border-border">
            <div className="w-7 h-7 rounded-lg bg-point/15 flex items-center justify-center">
              <SquareTerminal size={14} className="text-point" />
            </div>
          </div>

          <div className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none">
            {tabs.map((tab, i) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`group flex items-center gap-2 px-3 py-2 mx-0.5 my-1 text-xs font-medium transition-all shrink-0 relative rounded-xl ${
                  activeTab === tab.id
                    ? "text-foreground bg-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface-hover"
                }`}
              >
                <Circle
                  size={6}
                  fill="currentColor"
                  className={`shrink-0 ${tab.connected ? "text-success" : "text-muted-foreground/30"}`}
                />
                <span>Shell {i + 1}</span>
                <button
                  type="button"
                  aria-label="Close terminal"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="text-muted-foreground/50 hover:text-foreground hover:bg-surface-hover transition-all p-0.5 rounded"
                >
                  <X size={10} />
                </button>
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute bottom-0 left-2 right-2 h-[2px] bg-point rounded-full"
                    transition={{ type: "spring", duration: 0.3, bounce: 0.15 }}
                  />
                )}
              </button>
            ))}
            {isManager && (
              <button
                onClick={createTab}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-2 mx-0.5 my-1 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors shrink-0 rounded-xl"
              >
                <Plus size={12} />
                <span className="hidden sm:inline">{loading ? "Opening..." : "New"}</span>
              </button>
            )}
          </div>
        </div>

        {/* Terminal Area */}
        <div className="flex-1 min-h-0 relative">
          <AnimatePresence>
            {tabs.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center h-full"
              >
                <EmptyState
                  icon={<SquareTerminal size={32} className="text-muted-foreground" />}
                  title="No active terminals"
                  description="Open a new terminal session to get started."
                  action={
                    isManager ? (
                      <Button onClick={createTab} disabled={loading} leftIcon={<Plus size={14} />}>
                        {loading ? "Opening..." : "New Terminal"}
                      </Button>
                    ) : undefined
                  }
                />
              </motion.div>
            )}
          </AnimatePresence>
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="absolute inset-0"
              style={{ display: activeTab === tab.id ? "block" : "none" }}
            >
              <Terminal
                terminalId={tab.id}
                mode="interactive"
                onExit={() => handleExit(tab.id)}
                onConnectionChange={(c) => handleConnectionChange(tab.id, c)}
              />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
