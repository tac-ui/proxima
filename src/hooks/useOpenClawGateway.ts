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
  request: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
  subscribe: (event: string, handler: (payload: unknown) => void) => () => void;
  disconnect: () => void;
}

let reqCounter = 0;
function nextId(): string {
  return `pxm-${++reqCounter}-${Date.now().toString(36)}`;
}

export function useOpenClawGateway(): OpenClawGateway {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const listenersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());
  const authRef = useRef<{ token: string; port: number } | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const mountedRef = useRef(true);
  const connectingRef = useRef(false);

  const cleanup = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    // Reject all pending requests
    for (const [, pending] of pendingRef.current) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed"));
    }
    pendingRef.current.clear();
    setConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current || wsRef.current?.readyState === WebSocket.OPEN) return;
    connectingRef.current = true;

    try {
      // Fetch token from Proxima backend
      if (!authRef.current) {
        const res = await api.getOpenClawToken();
        if (!res.ok || !res.data) {
          connectingRef.current = false;
          return;
        }
        authRef.current = res.data;
      }

      const { token, port } = authRef.current;
      const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
      const wsUrl = `ws://${host}:${port}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Wait for connect.challenge event from server
      };

      ws.onmessage = (ev) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }

        // Handle server challenge → send auth
        if (msg.type === "event" && (msg as RpcEvent).event === "connect.challenge") {
          const authMsg: RpcRequest = {
            type: "req",
            id: nextId(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              auth: { token },
              client: {
                id: "proxima-ui",
                version: "1.0.0",
                mode: "browser",
                instanceId: nextId(),
              },
              role: "operator",
              scopes: ["operator.admin", "operator.read", "operator.write"],
              caps: ["chat-streaming"],
            },
          };
          ws.send(JSON.stringify(authMsg));
          return;
        }

        // Handle connect response
        if (msg.type === "res") {
          const res = msg as RpcResponse;

          // Check if this is the connect response (hello-ok)
          if (res.ok && !connected && pendingRef.current.size === 0) {
            setConnected(true);
            reconnectDelay.current = 1000;
            connectingRef.current = false;
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

        // Reject pending requests
        for (const [, pending] of pendingRef.current) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Connection closed"));
        }
        pendingRef.current.clear();

        // Auto-reconnect
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(() => {
            reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 30000);
            connect();
          }, reconnectDelay.current);
        }
      };
    } catch {
      connectingRef.current = false;
    }
  }, [connected, cleanup]);

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

  // Auto-connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  return { connected, request, subscribe, disconnect };
}
