"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { api } from "@/lib/api";

interface RpcRequest {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

interface RpcEvent {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
}

type WsMessage = RpcResponse | RpcEvent | { type: "req"; method: string; params?: Record<string, unknown> };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface OpenClawGateway {
  connected: boolean;
  /** True while we're actively trying to (re)connect — after an unexpected close. */
  reconnecting: boolean;
  request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void;
  disconnect: () => void;
  /** Force an immediate reconnect (used by visibility handler or manual recovery). */
  forceReconnect: () => void;
}

let reqCounter = 0;
function nextId(): string {
  return `pxm-${++reqCounter}-${Date.now().toString(36)}`;
}

// Application-level heartbeat: we send `health` periodically and expect a
// response within HEARTBEAT_TIMEOUT_MS. If the response is missing, we treat
// the connection as dead and force a reconnect. This catches "half-open" TCP
// where the socket looks fine but no data actually flows — common when a
// middlebox, firewall, or Docker bridge silently drops an idle TCP stream.
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export function useOpenClawGateway(): OpenClawGateway {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const listenersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());
  const authRef = useRef<{ token: string; port: number } | null>(null);
  const connectIdRef = useRef<string | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRetryAttempts = useRef(0);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const cleanupConnection = useCallback(() => {
    stopHeartbeat();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      try { wsRef.current.close(); } catch { /* ignore */ }
      wsRef.current = null;
    }
    for (const [, pending] of pendingRef.current) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    pendingRef.current.clear();
    connectIdRef.current = null;
    connectingRef.current = false;
  }, [stopHeartbeat]);

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    cleanupConnection();
    // Clear auth cache so next connect re-fetches the token
    authRef.current = null;
    setConnected(false);
    setReconnecting(false);
  }, [cleanupConnection]);

  const connect = useCallback(async () => {
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) return;
    connectingRef.current = true;
    if (mountedRef.current) setReconnecting(true);

    try {
      // Always re-fetch token (in case it was rotated or gateway restarted)
      const res = await api.getOpenClawToken();
      if (!res.ok || !res.data || !res.data.token) {
        connectingRef.current = false;
        // Token fetch failed — Proxima API itself may be booting. Schedule
        // retry with capped backoff so we recover when it comes up.
        tokenRetryAttempts.current += 1;
        if (mountedRef.current) {
          const delay = Math.min(2000 * Math.pow(1.5, tokenRetryAttempts.current - 1), 20_000);
          reconnectTimer.current = setTimeout(() => { connect(); }, delay);
        }
        return;
      }
      tokenRetryAttempts.current = 0;
      authRef.current = res.data;

      const { token } = authRef.current;
      // Use Proxima's own origin as proxy — avoids exposing gateway port 20242 externally
      const host = typeof window !== "undefined" ? window.location.host : "localhost";
      const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
      const wsUrl = `${protocol}://${host}/api/openclaw/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        // Handle server challenge → send auth with a tracked id
        if (msg.type === "event" && (msg as RpcEvent).event === "connect.challenge") {
          const connectId = nextId();
          connectIdRef.current = connectId;
          const authMsg: RpcRequest = {
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              auth: { token },
              client: {
                id: "openclaw-control-ui",
                displayName: "Proxima",
                version: "1.0.0",
                platform: typeof navigator !== "undefined" ? (navigator.platform || "web") : "web",
                mode: "webchat",
                instanceId: nextId(),
              },
              role: "operator",
              // Mirror CLI_DEFAULT_OPERATOR_SCOPES from the gateway: admin is
              // required for config.patch, sessions.delete, agents.files.set,
              // etc. The other scopes don't grant anything admin doesn't
              // already cover, but listing them keeps parity with the CLI.
              scopes: [
                "operator.admin",
                "operator.read",
                "operator.write",
                "operator.approvals",
                "operator.pairing",
                "operator.talk.secrets",
              ],
              caps: ["tool-events"],
              ...(typeof navigator !== "undefined" ? {
                userAgent: navigator.userAgent,
                locale: navigator.language,
              } : {}),
            },
          };
          ws.send(JSON.stringify(authMsg));
          return;
        }

        if (msg.type === "res") {
          const res = msg as RpcResponse;

          // Connect response: match by tracked id
          if (connectIdRef.current && res.id === connectIdRef.current) {
            connectIdRef.current = null;
            if (res.ok) {
              setConnected(true);
              setReconnecting(false);
              reconnectDelay.current = 1000;
              connectingRef.current = false;

              // Start application-level heartbeat so we detect half-open
              // connections where TCP looks alive but no data flows.
              stopHeartbeat();
              heartbeatTimer.current = setInterval(() => {
                const live = wsRef.current;
                if (!live || live.readyState !== WebSocket.OPEN) return;
                const hbId = nextId();
                const hbTimer = setTimeout(() => {
                  // No response → connection is dead. Force close so the
                  // normal onclose path kicks in and schedules reconnect.
                  pendingRef.current.delete(hbId);
                  try { live.close(4001, "heartbeat timeout"); } catch { /* ignore */ }
                }, HEARTBEAT_TIMEOUT_MS);
                pendingRef.current.set(hbId, {
                  resolve: () => { clearTimeout(hbTimer); pendingRef.current.delete(hbId); },
                  reject: () => { clearTimeout(hbTimer); pendingRef.current.delete(hbId); },
                  timer: hbTimer,
                });
                try {
                  live.send(JSON.stringify({ type: "req", id: hbId, method: "health" }));
                } catch {
                  clearTimeout(hbTimer);
                  pendingRef.current.delete(hbId);
                }
              }, HEARTBEAT_INTERVAL_MS);
            } else {
              // Auth failed - clear token cache and schedule reconnect
              authRef.current = null;
              try { ws.close(); } catch { /* ignore */ }
            }
            return;
          }

          // Route to pending request
          const pending = pendingRef.current.get(res.id);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRef.current.delete(res.id);
            if (res.ok) {
              pending.resolve(res.payload);
            } else {
              pending.reject(new Error(res.error?.message ?? "RPC error"));
            }
          }
          return;
        }

        // Handle events
        if (msg.type === "event") {
          const evt = msg as RpcEvent;
          const handlers = listenersRef.current.get(evt.event);
          if (handlers) {
            for (const handler of handlers) {
              try {
                handler(evt.payload);
              } catch { /* ignore handler errors */ }
            }
          }
        }
      };

      ws.onerror = () => {
        connectingRef.current = false;
      };

      ws.onclose = () => {
        setConnected(false);
        connectingRef.current = false;
        wsRef.current = null;
        // Clear auth cache so next reconnect re-fetches fresh token
        authRef.current = null;
        connectIdRef.current = null;
        stopHeartbeat();

        // Reject pending requests
        for (const [, pending] of pendingRef.current) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Connection closed"));
        }
        pendingRef.current.clear();

        // Auto-reconnect
        if (mountedRef.current) {
          setReconnecting(true);
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
            connect();
          }, reconnectDelay.current);
        }
      };
    } catch {
      connectingRef.current = false;
    }
  }, [stopHeartbeat]);

  const request = useCallback(<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected to OpenClaw gateway"));
        return;
      }

      const id = nextId();
      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, 30000);

      pendingRef.current.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      const msg: RpcRequest = { type: "req", id, method, params };
      ws.send(JSON.stringify(msg));
    });
  }, []);

  const subscribe = useCallback((event: string, handler: (payload: unknown) => void): (() => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(handler);
    return () => {
      listenersRef.current.get(event)?.delete(handler);
    };
  }, []);

  const disconnect = useCallback(() => {
    cleanup();
  }, [cleanup]);

  const forceReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    cleanupConnection();
    reconnectDelay.current = 1000;
    if (mountedRef.current) {
      setConnected(false);
      setReconnecting(true);
      void connect();
    }
  }, [cleanupConnection, connect]);

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    void connect();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  // Visibility-based health check: when the tab returns to foreground,
  // verify the socket is still OPEN. Many OS/network stacks drop silent
  // TCP after minutes in a background tab, and onclose might not fire
  // until we try to send. Force reconnect if we're not OPEN.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        forceReconnect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [forceReconnect]);

  return { connected, reconnecting, request, subscribe, disconnect, forceReconnect };
}
