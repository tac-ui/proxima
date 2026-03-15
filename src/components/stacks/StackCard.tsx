"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, CardFooter } from "@tac-ui/web";
import { Play, Square, ArrowRight, Monitor } from "@tac-ui/icon";
import type { StackListItem, StackStatus } from "@/types";

const statusVariantMap: Record<string, "success" | "destructive" | "warning" | "info" | "secondary"> = {
  running: "success",
  exited: "destructive",
  created: "warning",
  partial: "warning",
  unknown: "secondary",
  online: "success",
  offline: "destructive",
};

const statusLabelMap: Record<string, string> = {
  running: "Running",
  exited: "Exited",
  created: "Created",
  partial: "Partial",
  unknown: "Unknown",
  online: "Online",
  offline: "Offline",
};

interface StackCardProps {
  stack: StackListItem;
  onStart?: (name: string) => Promise<void>;
  onStop?: (name: string) => Promise<void>;
  isManager?: boolean;
}

export function StackCard({ stack, onStart, onStop, isManager }: StackCardProps) {
  const [actionLoading, setActionLoading] = useState<"start" | "stop" | null>(null);

  const handleStart = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!onStart) return;
    setActionLoading("start");
    try {
      await onStart(stack.name);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!onStop) return;
    setActionLoading("stop");
    try {
      await onStop(stack.name);
    } finally {
      setActionLoading(null);
    }
  };

  const isRunning = stack.status === "running";
  const updatedAt = new Date(stack.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Link href={`/stacks/${stack.name}`} className="block group">
      <Card interactive>
        <CardContent>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h3 className="font-semibold truncate group-hover:text-foreground transition-colors">
                {stack.name}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Updated {updatedAt}</p>
            </div>
            <Badge variant={statusVariantMap[stack.status] ?? "secondary"}>
              {statusLabelMap[stack.status] ?? stack.status}
            </Badge>
          </div>

          <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Monitor size={12} />
              <span>{stack.containerCount} container{stack.containerCount !== 1 ? "s" : ""}</span>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
            {isManager !== false && (
              isRunning ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={actionLoading !== null}
                  onClick={handleStop}
                  leftIcon={<Square size={12} />}
                >
                  {actionLoading === "stop" ? "Stopping..." : "Stop"}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={actionLoading !== null}
                  onClick={handleStart}
                  leftIcon={<Play size={12} />}
                >
                  {actionLoading === "start" ? "Starting..." : "Start"}
                </Button>
              )
            )}
            <Button variant="ghost" size="sm" rightIcon={<ArrowRight size={12} />}>
              Details
            </Button>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
}
