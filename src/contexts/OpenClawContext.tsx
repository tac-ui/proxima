"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useOpenClawGateway, type OpenClawGateway } from "@/hooks/useOpenClawGateway";
import { api } from "@/lib/api";
import type { OpenClawSession, OpenClawChannel, OpenClawSettings } from "@/types";

interface OpenClawContextValue {
  gateway: OpenClawGateway;
  enabled: boolean;
  settings: OpenClawSettings | null;
  sessions: OpenClawSession[];
  channels: OpenClawChannel[];
  refreshSessions: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const OpenClawContext = createContext<OpenClawContextValue | null>(null);

export function useOpenClaw() {
  const ctx = useContext(OpenClawContext);
  if (!ctx) throw new Error("useOpenClaw must be used within OpenClawProvider");
  return ctx;
}

export function OpenClawProvider({ children }: { children: React.ReactNode }) {
  const gateway = useOpenClawGateway();
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<OpenClawSettings | null>(null);
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [channels, setChannels] = useState<OpenClawChannel[]>([]);
  const initialLoadDone = useRef(false);

  const refreshSettings = useCallback(async () => {
    const res = await api.getOpenClawSettings();
    if (res.ok && res.data) {
      setSettings(res.data);
      setEnabled(res.data.enabled);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!gateway.connected) return;
    try {
      const result = await gateway.request<OpenClawSession[]>("sessions.list");
      if (Array.isArray(result)) setSessions(result);
    } catch {
      setSessions([]);
    }
  }, [gateway]);

  const refreshChannels = useCallback(async () => {
    if (!gateway.connected) return;
    try {
      const result = await gateway.request<Record<string, { status: string; name?: string }>>("channels.status");
      if (result && typeof result === "object") {
        setChannels(Object.entries(result).map(([type, info]) => ({
          type,
          status: (info.status === "connected" ? "connected" : "disconnected") as OpenClawChannel["status"],
          name: info.name,
        })));
      }
    } catch {
      setChannels([]);
    }
  }, [gateway]);

  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  useEffect(() => {
    if (gateway.connected && !initialLoadDone.current) {
      initialLoadDone.current = true;
      refreshSessions();
      refreshChannels();
    }
    if (!gateway.connected) initialLoadDone.current = false;
  }, [gateway.connected, refreshSessions, refreshChannels]);

  useEffect(() => {
    if (!gateway.connected) return;
    return gateway.subscribe("sessions.changed", () => { refreshSessions(); });
  }, [gateway, refreshSessions]);

  return (
    <OpenClawContext.Provider value={{ gateway, enabled, settings, sessions, channels, refreshSessions, refreshChannels, refreshSettings }}>
      {children}
    </OpenClawContext.Provider>
  );
}
