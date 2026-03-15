"use client";

import React, { useEffect, useRef, useState } from "react";

/** Suppress known xterm.js internal error — does not affect functionality */
if (typeof window !== "undefined") {
  const suppress = (e: Event | string) => {
    const msg = typeof e === "string" ? e : (e as ErrorEvent).message ?? "";
    if (msg.includes("reading 'dimensions'")) {
      if (e instanceof Event) e.preventDefault();
      return true;
    }
    return false;
  };
  window.addEventListener("error", (e) => { suppress(e); }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const msg = e.reason?.message ?? String(e.reason ?? "");
    if (msg.includes("reading 'dimensions'")) e.preventDefault();
  });
}

export interface TerminalHandle {
  clear: () => void;
}

interface TerminalProps {
  terminalId: string;
  mode?: "displayOnly" | "interactive";
  rows?: number;
  cols?: number;
  onExit?: (exitCode: number) => void;
  onConnectionChange?: (connected: boolean) => void;
  onReady?: (handle: TerminalHandle) => void;
}

/** Wait until container has non-zero dimensions */
function waitForLayout(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    if (el.clientWidth > 0 && el.clientHeight > 0) {
      resolve();
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        ro.disconnect();
        resolve();
      }
    });
    ro.observe(el);
  });
}

export function Terminal({ terminalId, mode = "interactive", rows, cols, onExit, onConnectionChange, onReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    onConnectionChangeRef.current?.(connected);
  }, [connected]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    let term: import("@xterm/xterm").Terminal;
    let ws: WebSocket | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon;

    const init = async () => {
      let isDisposed = false;
      const { Terminal: XTerm } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");

      term = new XTerm({
        theme: {
          background: "#0a0a0f",
          foreground: "#d4d4e8",
          cursor: "#818cf8",
          cursorAccent: "#0a0a0f",
          selectionBackground: "#6366f130",
          selectionForeground: "#f4f4fd",
          black: "#12121a",
          red: "#f87171",
          green: "#4ade80",
          yellow: "#fbbf24",
          blue: "#60a5fa",
          magenta: "#c084fc",
          cyan: "#22d3ee",
          white: "#d4d4e8",
          brightBlack: "#3a3a4e",
          brightRed: "#fca5a5",
          brightGreen: "#86efac",
          brightYellow: "#fde68a",
          brightBlue: "#93c5fd",
          brightMagenta: "#d8b4fe",
          brightCyan: "#67e8f9",
          brightWhite: "#f4f4fd",
        },
        fontFamily: "'D2Coding ligature', 'D2Coding', 'Cascadia Code', 'Fira Code', ui-monospace, monospace",
        fontSize: 13,
        lineHeight: 1.5,
        cursorBlink: true,
        scrollback: 1000,
        ...(rows ? { rows } : {}),
        ...(cols ? { cols } : {}),
      });

      fitAddon = new FitAddon();

      // 1. Wait for container to have non-zero dimensions (handles hidden tabs)
      await waitForLayout(container);
      if (isDisposed) return () => {};

      // 2. Open terminal on the DOM element first
      term.open(container);

      // 3. Load FitAddon after open — renderer must exist
      term.loadAddon(fitAddon);

      // 4. Safe fit helper — checks container visibility before fitting
      const safeFit = () => {
        try {
          if (!isDisposed && term.element && container.clientWidth > 0 && container.clientHeight > 0) {
            fitAddon.fit();
          }
        } catch {
          // Ignore internal FitAddon sizing errors
        }
      };

      // 5. Use setTimeout(0) to ensure browser has completed a full render cycle
      await new Promise<void>((resolve) => setTimeout(() => { safeFit(); resolve(); }, 0));
      if (isDisposed) return () => {};

      termRef.current = term;
      onReadyRef.current?.({ clear: () => term.clear() });

      // WebSocket connection
      const token = localStorage.getItem("proxima_auth_token") ?? "";
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/api/terminal?token=${encodeURIComponent(token)}`);

      ws.onopen = () => {
        setConnected(true);
        ws!.send(JSON.stringify({ type: "join", terminalId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.terminalId !== terminalId) return;
          if (msg.type === "write") {
            term.write(msg.data);
          } else if (msg.type === "buffer") {
            term.write(msg.data);
          } else if (msg.type === "exit") {
            term.writeln(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m`);
            onExitRef.current?.(msg.exitCode);
          }
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      if (mode === "interactive") {
        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "input", terminalId, data }));
          }
        });
      }

      // Resize observer — debounced FitAddon
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (isDisposed || !term.element || container.clientWidth === 0) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          safeFit();
          if (ws && ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "resize", terminalId, rows: term.rows, cols: term.cols }));
            } catch {}
          }
        }, 50);
      });
      resizeObserver.observe(container);

      return () => {
        isDisposed = true;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeObserver.disconnect();
        ws?.close();
        term.dispose();
        termRef.current = null;
      };
    };

    let cleanup: (() => void) | undefined;
    let aborted = false;
    init().then((fn) => {
      if (aborted) { fn?.(); return; }
      cleanup = fn;
    });

    return () => { aborted = true; cleanup?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, mode]);

  useEffect(() => {
    if (!connected && termRef.current) {
      termRef.current.writeln("\r\n\x1b[31m[Disconnected from server]\x1b[0m");
    }
  }, [connected]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ minHeight: rows ? `${rows * 20}px` : "200px", backgroundColor: "#0a0a0f" }}
    />
  );
}
