"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "@tac-ui/icon";
import { StatusDot } from "@tac-ui/web";

const MAX_OUTPUT_CHARS = 50_000;

// Strip ANSI escape codes for clean text display
function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return "...(truncated)\n" + text.slice(-MAX_OUTPUT_CHARS);
}

interface ScriptLogViewerProps {
  terminalId: string;
  title: string;
  /** Called when the process exits */
  onExit?: (exitCode: number, output: string) => void;
  /** Max height for the log area */
  maxHeight?: number;
  /** If provided, show this static output instead of connecting to WS */
  staticOutput?: string;
  /** Exit code to show (for static mode) */
  exitCode?: number;
}

export function ScriptLogViewer({
  terminalId,
  title,
  onExit,
  maxHeight = 300,
  staticOutput,
  exitCode: staticExitCode,
}: ScriptLogViewerProps) {
  const [output, setOutput] = useState(staticOutput ?? "");
  const [exited, setExited] = useState(staticOutput !== undefined);
  const [exitCode, setExitCode] = useState<number | undefined>(staticExitCode);
  const [expanded, setExpanded] = useState(true);
  const [disconnected, setDisconnected] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const outputRef = useRef(staticOutput ?? "");
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // Auto-scroll to bottom
  useEffect(() => {
    if (preRef.current && expanded) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [output, expanded]);

  // WebSocket connection for live mode
  useEffect(() => {
    if (staticOutput !== undefined) return;

    const token = localStorage.getItem("proxima_auth_token") ?? "";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/terminal`);

    ws.onopen = () => {
      // Send auth as the first message
      ws.send(JSON.stringify({ type: "auth", token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "auth" && msg.status === "ok") {
          setDisconnected(false);
          ws.send(JSON.stringify({ type: "join", terminalId }));
          return;
        }
        if (msg.terminalId !== terminalId) return;

        if (msg.type === "write" || msg.type === "buffer") {
          const text = stripAnsi(msg.data);
          outputRef.current += text;
          outputRef.current = capOutput(outputRef.current);
          setOutput(outputRef.current);
        } else if (msg.type === "exit") {
          setExited(true);
          setExitCode(msg.exitCode);
          onExitRef.current?.(msg.exitCode, outputRef.current);
        } else if (msg.type === "error") {
          // Terminal already exited before WS connected
          setExited(true);
          if (exitCode === undefined) setExitCode(undefined);
          setOutput(outputRef.current || "(process already finished)");
        }
      } catch (e) {
        console.warn("[ScriptLogViewer] Failed to parse message:", e);
      }
    };

    ws.onerror = () => {
      setDisconnected(true);
    };

    ws.onclose = () => {
      setDisconnected(true);
    };

    return () => {
      ws.close();
    };
  }, [terminalId, staticOutput]);

  const isError = exitCode !== undefined && exitCode !== 0;

  return (
    <div className={`rounded-lg border overflow-hidden ${isError ? "border-destructive/30" : exited ? "border-border" : "border-point/30"}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={`Toggle ${title} output`}
        className="flex items-center justify-between w-full px-3 py-1.5 bg-surface text-left hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {!exited && !disconnected && (
            <StatusDot status="success" size="sm" pulse />
          )}
          {disconnected && !exited && (
            <StatusDot status="warning" size="sm" />
          )}
          <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
          {exited && exitCode !== undefined && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isError ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}`}>
              {isError ? `exit ${exitCode}` : "done"}
            </span>
          )}
          {disconnected && !exited && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-warning/10 text-warning">
              disconnected
            </span>
          )}
        </div>
        {expanded ? <ChevronUp size={12} className="text-muted-foreground shrink-0" /> : <ChevronDown size={12} className="text-muted-foreground shrink-0" />}
      </button>

      {/* Output */}
      {expanded && (
        <pre
          ref={preRef}
          role="log"
          className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-all bg-[#0a0a0f] text-[#d4d4e8] px-3 py-2 overflow-y-auto"
          style={{ maxHeight }}
        >
          {output || (exited ? "(no output)" : disconnected ? "(connection lost)" : "Waiting for output...")}
        </pre>
      )}
    </div>
  );
}
