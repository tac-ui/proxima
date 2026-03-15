"use client";

import React, { useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Eraser, Maximize2, Minimize2 } from "@tac-ui/icon";
import type { TerminalHandle } from "./Terminal";

const Terminal = dynamic(
  () => import("@/components/terminal/Terminal").then((m) => m.Terminal),
  { ssr: false },
);

interface TerminalPanelProps {
  terminalId: string;
  title?: string;
  mode?: "interactive" | "displayOnly";
  rows?: number;
  onExit?: (exitCode: number) => void;
  showToolbar?: boolean;
  className?: string;
}

export function TerminalPanel({
  terminalId,
  title = "Terminal",
  mode = "interactive",
  rows,
  onExit,
  showToolbar = true,
  className = "",
}: TerminalPanelProps) {
  const handleRef = useRef<TerminalHandle | null>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const handleConnectionChange = useCallback((c: boolean) => {
    setConnected(c);
  }, []);

  const handleReady = useCallback((h: TerminalHandle) => {
    handleRef.current = h;
  }, []);

  const handleClear = useCallback(() => {
    handleRef.current?.clear();
  }, []);

  return (
    <div
      className={`flex flex-col ${
        fullscreen
          ? "fixed inset-0 z-50 bg-background"
          : `rounded-xl border border-border overflow-hidden ${className}`
      }`}
    >
      {showToolbar && (
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface border-b border-border shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                connected ? "bg-success" : "bg-error"
              }`}
            />
            <span className="text-xs font-medium text-muted-foreground truncate">
              {title}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              title="Clear"
            >
              <Eraser size={12} />
              <span>Clear</span>
            </button>
            <button
              onClick={() => setFullscreen((f) => !f)}
              className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
              title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          </div>
        </div>
      )}
      <div
        className={fullscreen ? "flex-1 min-h-0" : ""}
        style={fullscreen ? undefined : { height: rows ? `${rows * 20}px` : "280px" }}
      >
        <Terminal
          terminalId={terminalId}
          mode={mode}
          rows={rows}
          onExit={onExit}
          onConnectionChange={handleConnectionChange}
          onReady={handleReady}
        />
      </div>
    </div>
  );
}
