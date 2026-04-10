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
      interface AccountSnapshot {
        accountId: string;
        configured?: boolean;
        connected?: boolean;
        enabled?: boolean;
        running?: boolean;
        lastError?: string;
        name?: string;
      }
      interface ChannelsStatusResponse {
        channelOrder?: string[];
        channelLabels?: Record<string, string>;
        channelAccounts?: Record<string, AccountSnapshot[]>;
        channelDefaultAccountId?: Record<string, string>;
      }
      const result = await gateway.request<ChannelsStatusResponse>("channels.status");
      const order = result.channelOrder ?? Object.keys(result.channelAccounts ?? {});
      const next: OpenClawChannel[] = order.map((type) => {
        const accounts = result.channelAccounts?.[type] ?? [];
        const defaultId = result.channelDefaultAccountId?.[type];
        const account = accounts.find(a => a.accountId === defaultId) ?? accounts[0];
        const configured = account?.configured === true;
        const enabled = account?.enabled !== false;
        const running = account?.running === true || account?.connected === true;
        const status: OpenClawChannel["status"] = account?.lastError
          ? "error"
          : running
            ? "connected"
            : "disconnected";
        return {
          type,
          status,
          configured,
          enabled,
          label: result.channelLabels?.[type],
          name: account?.name,
          lastError: account?.lastError,
        };
      });
      setChannels(next);
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
