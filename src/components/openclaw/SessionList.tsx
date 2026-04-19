"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Badge, EmptyState, Input } from "@tac-ui/web";
import { Plus, Trash2, MessageSquare, RefreshCw, Search } from "@tac-ui/icon";
import type { OpenClawSession } from "@/types";

interface SessionListProps {
  sessions: OpenClawSession[];
  onCreateSession: () => void;
  onDeleteSession: (key: string) => void;
  onRefresh?: () => void;
  creating?: boolean;
  refreshing?: boolean;
  connected?: boolean;
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function SessionList({
  sessions,
  onCreateSession,
  onDeleteSession,
  onRefresh,
  creating,
  refreshing,
  connected = true,
}: SessionListProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    // Sort by most recently active first
    const sorted = [...sessions].sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((s) => {
      const label = (s.label ?? "").toLowerCase();
      const key = s.key.toLowerCase();
      const model = (s.modelRef ?? "").toLowerCase();
      return label.includes(q) || key.includes(q) || model.includes(q);
    });
  }, [sessions, search]);

  const showSearch = sessions.length > 3;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium">Sessions</p>
          {sessions.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({sessions.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing || !connected}
              aria-label="Refresh sessions"
              title="Refresh sessions"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreateSession}
            disabled={creating || !connected}
            leftIcon={<Plus size={14} />}
          >
            {creating ? "Creating..." : "New Session"}
          </Button>
        </div>
      </div>

      {/* Search — only when there are enough sessions to warrant it */}
      <AnimatePresence initial={false}>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <Input
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Search sessions by name, key, or model..."
              size="sm"
              leftIcon={<Search size={12} />}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sessions.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={32} />}
          title={connected ? "No sessions yet" : "Gateway disconnected"}
          description={
            connected
              ? "Create a session to start chatting."
              : "Start the gateway from the header to manage sessions."
          }
          action={
            connected ? (
              <Button
                variant="primary"
                size="sm"
                onClick={onCreateSession}
                disabled={creating}
                leftIcon={<Plus size={14} />}
              >
                {creating ? "Creating..." : "Create your first session"}
              </Button>
            ) : undefined
          }
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            No sessions match <span className="font-mono">&ldquo;{search}&rdquo;</span>
          </p>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline mt-1"
            onClick={() => setSearch("")}
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {filtered.map((session, idx) => (
              <motion.div
                key={session.key}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="border border-border rounded-lg hover:border-foreground/30 hover:bg-muted/20 transition-colors group"
              >
                <div className="flex items-center gap-2 p-2.5">
                  <Link
                    href={`/openclaw/chat/${encodeURIComponent(session.key)}`}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <MessageSquare size={12} className="text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate">
                      {session.label || session.key}
                    </span>
                    {session.active && (
                      <Badge variant="success">Active</Badge>
                    )}
                    {idx === 0 && session.lastActivityAt && !session.active && (
                      <Badge variant="info">Recent</Badge>
                    )}
                    {session.modelRef && (
                      <span
                        className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px] hidden sm:block"
                        title={session.modelRef}
                      >
                        {session.modelRef}
                      </span>
                    )}
                  </Link>
                  {session.lastActivityAt && (
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                      {formatRelativeTime(session.lastActivityAt)}
                    </span>
                  )}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-error transition-colors sm:opacity-0 sm:group-hover:opacity-100 shrink-0 p-1 rounded"
                    onClick={(e) => { e.preventDefault(); onDeleteSession(session.key); }}
                    aria-label={`Delete session ${session.label || session.key}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
