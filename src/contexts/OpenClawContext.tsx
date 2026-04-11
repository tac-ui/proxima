"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { useOpenClawGateway, type OpenClawGateway } from "@/hooks/useOpenClawGateway";
import { useToast } from "@tac-ui/web";
import { api } from "@/lib/api";
import type { OpenClawSession, OpenClawChannel, OpenClawSettings } from "@/types";

interface OpenClawContextValue {
  gateway: OpenClawGateway;
  enabled: boolean;
  settings: OpenClawSettings | null;
  sessions: OpenClawSession[];
  channels: OpenClawChannel[];
  /** Cached openclaw config object (result of the `config.get` RPC). */
  config: Record<string, unknown> | null;
  /** Base hash of the cached config, required by `config.patch`/`config.set`. */
  configHash: string | null;
  /** True while config is being fetched from the gateway. */
  configLoading: boolean;
  /** True while channels.status is being fetched. */
  channelsLoading: boolean;
  /** Staged default-model change waiting to be committed. `undefined` = no pending change. */
  pendingModel: string | undefined;
  /** True while a bundled commit is in-flight. */
  committing: boolean;
  refreshSessions: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshConfig: () => Promise<void>;
  /** Stage a default-model change. Call `commitPendingPatch()` or a channel save to persist. */
  stageModel: (modelId: string | undefined) => void;
  /** Discard any staged model change. */
  discardPendingModel: () => void;
  /**
   * Bundle any staged changes (currently just `pendingModel`) with the given
   * extra patch and commit them as a single `config.patch` RPC. Refreshes
   * the config and channels caches on success. Returns true on success.
   */
  commitPendingPatch: (extraPatch?: Record<string, unknown>) => Promise<boolean>;
}

const OpenClawContext = createContext<OpenClawContextValue | null>(null);

export function useOpenClaw() {
  const ctx = useContext(OpenClawContext);
  if (!ctx) throw new Error("useOpenClaw must be used within OpenClawProvider");
  return ctx;
}

export function OpenClawProvider({ children }: { children: React.ReactNode }) {
  const gateway = useOpenClawGateway();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<OpenClawSettings | null>(null);
  const [sessions, setSessions] = useState<OpenClawSession[]>([]);
  const [channels, setChannels] = useState<OpenClawChannel[]>([]);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | undefined>(undefined);
  const [committing, setCommitting] = useState(false);
  const initialLoadDone = useRef(false);
  // Ref mirror of `committing` so the polling loop can check the latest value
  // without re-subscribing on every state flip.
  const committingRef = useRef(false);
  useEffect(() => { committingRef.current = committing; }, [committing]);
  // Ref mirror of configHash so the polling callback can read the latest
  // value without re-subscribing every time the hash updates.
  const configHashRef = useRef<string | null>(null);
  useEffect(() => { configHashRef.current = configHash; }, [configHash]);

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
    setChannelsLoading(true);
    try {
      interface AccountSnapshot {
        accountId: string;
        configured?: boolean;
        connected?: boolean;
        enabled?: boolean;
        running?: boolean;
        linked?: boolean;
        lastError?: string;
        lastConnectedAt?: number;
        healthState?: string;
        name?: string;
        tokenSource?: string;
        botTokenSource?: string;
        appTokenSource?: string;
      }
      interface ChannelSummary {
        configured?: boolean;
        linked?: boolean | null;
      }
      interface ChannelsStatusResponse {
        channelOrder?: string[];
        channelLabels?: Record<string, string>;
        channels?: Record<string, ChannelSummary>;
        channelAccounts?: Record<string, AccountSnapshot[]>;
        channelDefaultAccountId?: Record<string, string>;
      }

      const hasRealToken = (account?: AccountSnapshot): boolean => {
        if (!account) return false;
        const sources = [account.tokenSource, account.botTokenSource, account.appTokenSource];
        return sources.some(s => typeof s === "string" && s.length > 0 && s !== "none");
      };

      const result = await gateway.request<ChannelsStatusResponse>("channels.status");
      const order = result.channelOrder ?? Object.keys(result.channelAccounts ?? {});
      const next: OpenClawChannel[] = order.map((type) => {
        const accounts = result.channelAccounts?.[type] ?? [];
        const defaultId = result.channelDefaultAccountId?.[type];
        const account = accounts.find(a => a.accountId === defaultId) ?? accounts[0];
        const summary = result.channels?.[type];

        // Configured must actually have a token — plugin defaults can flip
        // `configured: true` even when no credential is set, which gave us
        // phantom "Connected" states. Require a real token source too.
        const summarySaysConfigured = summary?.configured === true;
        const accountSaysConfigured = account?.configured === true;
        const configured = (summarySaysConfigured || accountSaysConfigured) && hasRealToken(account);

        const enabled = account?.enabled !== false;

        // Connected = strict: summary linked flag OR account explicitly
        // reports connected. `running` alone (plugin worker alive) does
        // NOT mean the bot is actually logged into Telegram/Discord.
        const connected = (summary?.linked === true) || (account?.connected === true);

        const status: OpenClawChannel["status"] = account?.lastError
          ? "error"
          : connected && configured
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
          lastSeen: account?.lastConnectedAt,
        };
      });
      setChannels(next);
    } catch {
      setChannels([]);
    }
    setChannelsLoading(false);
  }, [gateway]);

  const refreshConfig = useCallback(async () => {
    if (!gateway.connected) return;
    setConfigLoading(true);
    try {
      const result = await gateway.request<{ config: Record<string, unknown>; hash: string }>("config.get");
      setConfig(result.config);
      setConfigHash(result.hash);
    } catch {
      // Keep prior cache on error — dropping it would force every consumer
      // into a skeleton state, which is worse than stale data for a transient
      // gateway hiccup.
    }
    setConfigLoading(false);
  }, [gateway]);

  const stageModel = useCallback((modelId: string | undefined) => {
    setPendingModel(modelId);
  }, []);

  const discardPendingModel = useCallback(() => {
    setPendingModel(undefined);
  }, []);

  const commitPendingPatch = useCallback(async (extraPatch?: Record<string, unknown>): Promise<boolean> => {
    if (!gateway.connected) return false;
    if (!configHash) return false;

    // Bundle staged model change with the caller's extra patch so a single
    // config.patch RPC triggers exactly one gateway reload, even when the
    // user changed both the default model and a channel in the same session.
    const patch: Record<string, unknown> = { ...(extraPatch ?? {}) };
    if (pendingModel !== undefined) {
      const existingAgents = (patch.agents as Record<string, unknown> | undefined) ?? {};
      const existingDefaults = (existingAgents.defaults as Record<string, unknown> | undefined) ?? {};
      patch.agents = {
        ...existingAgents,
        defaults: { ...existingDefaults, model: pendingModel },
      };
    }

    if (Object.keys(patch).length === 0) return true;

    setCommitting(true);
    try {
      await gateway.request("config.patch", {
        raw: JSON.stringify(patch),
        baseHash: configHash,
        restartDelayMs: 1000,
      });
      // Clear staged state BEFORE refresh — otherwise the refreshed config
      // would still see the pending marker.
      setPendingModel(undefined);
      await refreshConfig();
      await refreshChannels();
      return true;
    } catch {
      return false;
    } finally {
      setCommitting(false);
    }
  }, [gateway, configHash, pendingModel, refreshConfig, refreshChannels]);

  useEffect(() => { refreshSettings(); }, [refreshSettings]);

  useEffect(() => {
    if (gateway.connected && !initialLoadDone.current) {
      initialLoadDone.current = true;
      // Load everything in parallel so the Setup tab has data ready by the
      // time the user navigates to it.
      Promise.all([
        refreshSessions(),
        refreshChannels(),
        refreshConfig(),
      ]).catch(() => { /* individual failures are handled inside */ });
    }
    if (!gateway.connected) {
      initialLoadDone.current = false;
      // IMPORTANT: keep `config`, `configHash`, `channels`, `sessions`
      // as a stale cache during reconnect so the UI can still render the
      // last-known values (read-only). Clearing them would make the Setup
      // tab look empty, which users find alarming ("where did my settings
      // go?"). The next successful reconnect overwrites the cache.
    }
  }, [gateway.connected, refreshSessions, refreshChannels, refreshConfig]);

  useEffect(() => {
    if (!gateway.connected) return;
    return gateway.subscribe("sessions.changed", () => { refreshSessions(); });
  }, [gateway, refreshSessions]);

  // ---------------------------------------------------------------------
  // External-change detection
  // ---------------------------------------------------------------------
  // OpenClaw does not broadcast a config-changed event, so we poll
  // `config.get` periodically and update the cache only when the hash
  // actually changes. This catches model / channel changes that a user
  // makes via the openclaw CLI, an agent tool call, or a chat message
  // asking the bot to switch models.
  //
  // To stay cheap:
  //   - Only poll while the tab is visible (Page Visibility API).
  //   - Skip ticks while a local commit is in flight (pendingModel race).
  //   - Only rewrite state when the hash differs — otherwise no re-render.
  //   - On tab-visibility restore, refresh immediately.

  const quietRefreshConfig = useCallback(async () => {
    if (!gateway.connected) return;
    if (committingRef.current) return;
    try {
      const result = await gateway.request<{ config: Record<string, unknown>; hash: string }>("config.get");
      if (result.hash !== configHashRef.current) {
        // Only surface a toast when this is an *external* change (the
        // previous hash was non-null, meaning we already had a cache that
        // is now stale). The very first poll after connect has a null
        // prev hash and shouldn't be treated as a change notification.
        const isExternalChange = configHashRef.current !== null;
        setConfig(result.config);
        setConfigHash(result.hash);
        if (isExternalChange) {
          toast("Config updated externally", { variant: "info" });
        }
      }
    } catch {
      // Transient errors are ignored — next tick will retry.
    }
  }, [gateway, toast]);

  useEffect(() => {
    if (!gateway.connected) return;

    const POLL_INTERVAL_MS = 15_000;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      quietRefreshConfig();
      refreshChannels();
    };

    const intervalId = setInterval(tick, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        // User came back to the tab — refresh immediately instead of
        // waiting up to 15s for the next poll tick.
        quietRefreshConfig();
        refreshChannels();
        refreshSessions();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [gateway.connected, quietRefreshConfig, refreshChannels, refreshSessions]);

  return (
    <OpenClawContext.Provider
      value={{
        gateway,
        enabled,
        settings,
        sessions,
        channels,
        config,
        configHash,
        configLoading,
        channelsLoading,
        pendingModel,
        committing,
        refreshSessions,
        refreshChannels,
        refreshSettings,
        refreshConfig,
        stageModel,
        discardPendingModel,
        commitPendingPatch,
      }}
    >
      {children}
    </OpenClawContext.Provider>
  );
}
