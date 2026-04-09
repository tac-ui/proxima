"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useOpenClawGateway, type OpenClawGateway } from "@/hooks/useOpenClawGateway";
import { api } from "@/lib/api";
import type { OpenClawSession, OpenClawChannel, OpenClawUsage, OpenClawSettings } from "@/types";

interface OpenClawContextValue {
  gateway: OpenClawGateway;
  enabled: boolean;
  settings: OpenClawSettings | null;
  sessions: OpenClawSession[];
  channels: OpenClawChannel[];
  usage: OpenClawUsage | null;
  refreshSessions: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshUsage: () => Promise<void>;
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
  const [usage, setUsage] = useState<OpenClawUsage | null>(null);
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
      if (Array.isArray(result)) {
        setSessions(result);
      }
    } catch {
      // Gateway may not support this method yet
      setSessions([]);
    }
  }, [gateway]);

  const refreshChannels = useCallback(async () => {
    if (!gateway.connected) return;
    try {
      const result = await gateway.request<Record<string, { status: string; name?: string; lastSeen?: number }>>("channels.status");
      if (result && typeof result === "object") {
        const list: OpenClawChannel[] = Object.entries(result).map(([type, info]) => ({
          type,
          status: (info.status === "connected" ? "connected" : "disconnected") as OpenClawChannel["status"],
          name: info.name,
          lastSeen: info.lastSeen,
        }));
        setChannels(list);
      }
    } catch {
      setChannels([]);
    }
  }, [gateway]);

  const refreshUsage = useCallback(async () => {
    if (!gateway.connected) return;
    try {
      const result = await gateway.request<OpenClawUsage>("usage.status");
      if (result) setUsage(result);
    } catch {
      setUsage(null);
    }
  }, [gateway]);

  // Load settings on mount
  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // Load gateway data when connected
  useEffect(() => {
    if (gateway.connected && !initialLoadDone.current) {
      initialLoadDone.current = true;
      refreshSessions();
      refreshChannels();
      refreshUsage();
    }
    if (!gateway.connected) {
      initialLoadDone.current = false;
    }
  }, [gateway.connected, refreshSessions, refreshChannels, refreshUsage]);

  // Subscribe to session changes
  useEffect(() => {
    if (!gateway.connected) return;
    const unsub = gateway.subscribe("sessions.changed", () => {
      refreshSessions();
    });
    return unsub;
  }, [gateway, refreshSessions]);

  return (
    <OpenClawContext.Provider
      value={{
        gateway,
        enabled,
        settings,
        sessions,
        channels,
        usage,
        refreshSessions,
        refreshChannels,
        refreshUsage,
        refreshSettings,
      }}
    >
      {children}
    </OpenClawContext.Provider>
  );
}
