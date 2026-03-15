"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";

interface ApiContextValue {
  connected: boolean;
  connectionFailed: boolean;
  subscribe: (eventType: string, handler: (data: any) => void) => () => void;
}

const ApiContext = createContext<ApiContextValue>({
  connected: false,
  connectionFailed: false,
  subscribe: () => () => {},
});

const TOKEN_KEY = "proxima_auth_token";

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const listenersRef = useRef(new Map<string, Set<(data: any) => void>>());
  const retryCount = useRef(0);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    // Close existing connection
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      retryCount.current = 0;
      setConnected(true);
      setConnectionFailed(false);
    });

    es.onerror = () => {
      setConnected(false);
      retryCount.current += 1;
      if (retryCount.current >= 5) {
        es.close();
        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, retryCount.current - 5), 30000);
        retryTimeout.current = setTimeout(() => {
          retryCount.current = 0;
          setConnectionFailed(false);
          connect();
        }, delay);
      }
    };

    // Register listeners for all SSE event types
    const eventTypes = ["stackList", "stackStatus", "proxyHostList", "discoveredServices", "gitProgress"];
    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          listenersRef.current.get(eventType)?.forEach(fn => fn(data));
        } catch {}
      });
    }
  }, []);

  // Try initial connection check via health endpoint
  useEffect(() => {
    fetch("/api/health")
      .then(res => {
        if (res.ok) {
          setConnected(true);
          setConnectionFailed(false);
          connect();
        }
      })
      .catch(() => {
        setConnectionFailed(true);
      });

    return () => {
      esRef.current?.close();
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
    };
  }, [connect]);

  const subscribe = useCallback((eventType: string, handler: (data: any) => void) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType)!.add(handler);

    return () => {
      listenersRef.current.get(eventType)?.delete(handler);
    };
  }, []);

  // Watch for token changes to trigger SSE reconnect after login
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY) {
        if (e.newValue) {
          connect();
        } else {
          esRef.current?.close();
          setConnected(false);
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [connect]);

  return (
    <ApiContext.Provider value={{ connected, connectionFailed, subscribe }}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApiContext() {
  return useContext(ApiContext);
}

// Export a trigger for use after login (dispatches a storage event to reconnect SSE)
export function triggerSSEConnect() {
  window.dispatchEvent(new StorageEvent("storage", { key: TOKEN_KEY, newValue: localStorage.getItem(TOKEN_KEY) }));
}
