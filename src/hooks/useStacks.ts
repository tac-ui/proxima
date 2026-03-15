"use client";

import { useCallback, useEffect, useState } from "react";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import type { StackListItem, StackStatus } from "@/types";

export function useStacks() {
  const { connected, subscribe } = useApiContext();
  const [stackList, setStackList] = useState<StackListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStacks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getStacks();
      if (res.ok && res.data) {
        setStackList(res.data);
      } else {
        setError(res.error ?? "Failed to load stacks");
      }
    } catch {
      setError("Failed to load stacks");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (connected) fetchStacks();
  }, [connected, fetchStacks]);

  // SSE subscriptions for real-time updates
  useEffect(() => {
    const unsub1 = subscribe("stackList", (stacks: StackListItem[]) => {
      setStackList(stacks);
    });
    const unsub2 = subscribe("stackStatus", (data: { name: string; status: StackStatus }) => {
      setStackList(prev => prev.map(s => s.name === data.name ? { ...s, status: data.status } : s));
    });
    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  const deploy = useCallback(
    async (name: string, yaml: string, env: string, isNew: boolean, dockerfiles?: Record<string, string>) => {
      const res = await api.deployStack(name, yaml, env, isNew, dockerfiles);
      if (!res.ok) throw new Error(res.error ?? "Deploy failed");
    }, []
  );

  const start = useCallback(async (name: string) => {
    const res = await api.startStack(name);
    if (!res.ok) throw new Error(res.error ?? "Start failed");
  }, []);

  const stop = useCallback(async (name: string) => {
    const res = await api.stopStack(name);
    if (!res.ok) throw new Error(res.error ?? "Stop failed");
  }, []);

  const restart = useCallback(async (name: string) => {
    const res = await api.restartStack(name);
    if (!res.ok) throw new Error(res.error ?? "Restart failed");
  }, []);

  const remove = useCallback(async (name: string) => {
    const res = await api.deleteStack(name);
    if (!res.ok) throw new Error(res.error ?? "Delete failed");
  }, []);

  return { stackList, loading, error, refetch: fetchStacks, deploy, start, stop, restart, remove };
}
