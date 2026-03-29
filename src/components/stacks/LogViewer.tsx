"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Input, Badge } from "@tac-ui/web";
import {
  Download,
  Search,
  X,
  ArrowDownToLine,
  RotateCw,
} from "@tac-ui/icon";
import type { ContainerInfo } from "@/types";

const TOKEN_KEY = "proxima_auth_token";
const MAX_LOG_LINES = 10000;

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

interface LogViewerProps {
  stackName: string;
  containers: ContainerInfo[];
}

export function LogViewer({ stackName, containers }: LogViewerProps) {
  const [selectedService, setSelectedService] = useState<string>("all");
  const [logs, setLogs] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Unique service names from containers
  const services = Array.from(
    new Set(containers.map((c) => c.service).filter(Boolean)),
  );

  const scrollToBottom = useCallback(() => {
    if (follow && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [follow]);

  // Fetch initial logs
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedService === "all") {
        const res = await api.getStackLogs(stackName);
        if (res.ok && res.data) {
          setLogs(res.data.logs);
        }
      } else {
        const res = await api.getServiceLogs(stackName, selectedService);
        if (res.ok && res.data) {
          setLogs(res.data.logs);
        }
      }
    } finally {
      setLoading(false);
      requestAnimationFrame(scrollToBottom);
    }
  }, [stackName, selectedService, scrollToBottom]);

  // Setup SSE streaming for individual services
  useEffect(() => {
    // Cleanup previous stream
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (selectedService === "all") return;

    const token = getToken();
    if (!token) return;

    const url = `/api/stacks/${encodeURIComponent(stackName)}/logs/${encodeURIComponent(selectedService)}/stream`;

    // EventSource doesn't support custom headers, so we use fetch-based SSE
    const abortController = new AbortController();

    const startStream = async () => {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: abortController.signal,
        });

        if (!res.ok || !res.body) return;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") return;
              try {
                const logLine = JSON.parse(data) as string;
                setLogs((prev) => {
                  const lines = (prev + logLine + "\n").split("\n");
                  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
                  return lines.join("\n");
                });
                requestAnimationFrame(scrollToBottom);
              } catch {
                // not JSON, append as-is
                if (data.trim()) {
                  setLogs((prev) => {
                    const lines = (prev + data + "\n").split("\n");
                    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
                    return lines.join("\n");
                  });
                  requestAnimationFrame(scrollToBottom);
                }
              }
            }
          }
        }
      } catch {
        // aborted or network error
      }
    };

    startStream();

    return () => {
      abortController.abort();
    };
  }, [stackName, selectedService, scrollToBottom]);

  // Fetch logs when service changes
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClear = () => {
    setLogs("");
  };

  const handleDownload = () => {
    if (selectedService === "all") {
      // Download combined logs as text
      const blob = new Blob([logs], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stackName}-all-logs.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // Use the download endpoint
      const token = getToken();
      const url = `/api/stacks/${encodeURIComponent(stackName)}/logs/${encodeURIComponent(selectedService)}/download`;

      fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((res) => res.blob())
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `${stackName}-${selectedService}-logs.txt`;
          link.click();
          URL.revokeObjectURL(blobUrl);
        });
    }
  };

  // Handle scroll - disable follow when user scrolls up
  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (!isAtBottom && follow) {
      setFollow(false);
    }
  };

  // Filter logs by search query (memoized to avoid O(n) re-split on every render)
  const displayedLines = useMemo(() => {
    return logs.split("\n").filter((line) => {
      if (!searchQuery) return true;
      return line.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [logs, searchQuery]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Service selector tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-2 mb-2 border-b border-border flex-shrink-0">
        <button
          onClick={() => setSelectedService("all")}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
            selectedService === "all"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          All
        </button>
        {services.map((svc) => {
          const container = containers.find((c) => c.service === svc);
          return (
            <button
              key={svc}
              onClick={() => setSelectedService(svc)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors inline-flex items-center gap-1.5 ${
                selectedService === svc
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {svc}
              {container && (
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    container.state === "running"
                      ? "bg-green-500"
                      : container.state === "exited"
                        ? "bg-red-500"
                        : "bg-yellow-500"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Filter logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-8 text-xs bg-muted/50 border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={() => {
            setFollow(!follow);
            if (!follow) {
              requestAnimationFrame(scrollToBottom);
            }
          }}
          title={follow ? "Auto-scroll on" : "Auto-scroll off"}
        >
          <ArrowDownToLine
            size={14}
            className={follow ? "text-primary" : "text-muted-foreground"}
          />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={fetchLogs}
          loading={loading}
          title="Refresh logs"
        >
          {!loading && <RotateCw size={14} />}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={handleDownload}
          title="Download logs"
        >
          <Download size={14} />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={handleClear}
          title="Clear display"
        >
          <X size={14} />
        </Button>

        {searchQuery && (
          <Badge variant="secondary" className="text-xs">
            {displayedLines.filter((l) => l.trim()).length} matches
          </Badge>
        )}
      </div>

      {/* Log output */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-[200px] overflow-y-auto bg-[#0d1117] rounded-lg p-3 font-mono text-xs leading-relaxed"
      >
        {loading && !logs ? (
          <span className="text-muted-foreground">Loading...</span>
        ) : displayedLines.length === 0 ||
          (displayedLines.length === 1 && !displayedLines[0].trim()) ? (
          <span className="text-muted-foreground">No logs available.</span>
        ) : (
          displayedLines.map((line, i) => {
            if (!line.trim()) return null;
            // Try to split timestamp from content
            // Docker timestamps look like: 2024-01-01T00:00:00.000000000Z
            const tsMatch = line.match(
              /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)\s*(.*)/,
            );
            if (tsMatch) {
              const [, ts, content] = tsMatch;
              const highlight =
                searchQuery &&
                content.toLowerCase().includes(searchQuery.toLowerCase());
              return (
                <div
                  key={i}
                  className={`whitespace-pre-wrap break-all ${highlight ? "bg-yellow-500/20" : ""}`}
                >
                  <span className="text-muted-foreground select-none">
                    {formatTimestamp(ts)}{" "}
                  </span>
                  <span className="text-gray-200">{content}</span>
                </div>
              );
            }

            // No timestamp - show as plain
            const highlight =
              searchQuery &&
              line.toLowerCase().includes(searchQuery.toLowerCase());
            return (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all text-gray-200 ${highlight ? "bg-yellow-500/20" : ""}`}
              >
                {line}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts.slice(11, 19); // fallback: extract HH:MM:SS
  }
}
