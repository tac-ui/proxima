"use client";

import React from "react";
import Link from "next/link";
import { Button, Badge, EmptyState } from "@tac-ui/web";
import { Plus, Trash2, MessageSquare } from "@tac-ui/icon";
import type { OpenClawSession } from "@/types";

interface SessionListProps {
  sessions: OpenClawSession[];
  onCreateSession: () => void;
  onDeleteSession: (key: string) => void;
  creating?: boolean;
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

export function SessionList({ sessions, onCreateSession, onDeleteSession, creating, connected = true }: SessionListProps) {
  // Sort by most recently active first
  const sorted = [...sessions].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Sessions</p>
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

      {sorted.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={32} />}
          title="No sessions yet"
          description="Create a new session to start chatting"
          action={
            <Button variant="primary" size="sm" onClick={onCreateSession} disabled={!connected} leftIcon={<Plus size={14} />}>
              New Session
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {sorted.map((session, idx) => (
            <div
              key={session.key}
              className="border border-border rounded-lg p-3 hover:border-foreground/20 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Link
                  href={`/openclaw/chat/${encodeURIComponent(session.key)}`}
                  className="flex-1 min-w-0"
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={14} className="text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">
                      {session.label || session.key}
                    </span>
                    {session.active && <Badge variant="success">Active</Badge>}
                    {idx === 0 && session.lastActivityAt && <Badge variant="info">Recent</Badge>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 ml-[22px]">
                    {session.modelRef && (
                      <Badge variant="secondary">{session.modelRef}</Badge>
                    )}
                    {session.lastActivityAt && (
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(session.lastActivityAt)}</span>
                    )}
                  </div>
                </Link>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-error transition-colors sm:opacity-0 sm:group-hover:opacity-100 shrink-0 p-1"
                  onClick={(e) => { e.preventDefault(); onDeleteSession(session.key); }}
                  aria-label={`Delete session ${session.label || session.key}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
