"use client";

import { useCallback, useEffect, useState } from "react";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import type { ProxyHost } from "@/types";

export function useRoutes() {
  const { connected, subscribe } = useApiContext();
  const [routeList, setRouteList] = useState<ProxyHost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getRoutes();
      if (res.ok && res.data) setRouteList(res.data);
      else setError(res.error ?? "Failed to load routes");
    } catch {
      setError("Failed to load routes");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (connected) fetchRoutes();
  }, [connected, fetchRoutes]);

  useEffect(() => {
    const unsub = subscribe("proxyHostList", (hosts: ProxyHost[]) => {
      setRouteList(hosts);
    });
    return unsub;
  }, [subscribe]);

  const create = useCallback(async (data: Partial<ProxyHost>): Promise<ProxyHost & { warnings?: string[] }> => {
    const res = await api.createRoute(data);
    if (res.ok && res.data) return res.data as ProxyHost & { warnings?: string[] };
    throw new Error(res.error ?? "Create failed");
  }, []);

  const update = useCallback(async (id: number, data: Partial<ProxyHost>): Promise<ProxyHost & { warnings?: string[] }> => {
    const res = await api.updateRoute(id, data);
    if (res.ok && res.data) return res.data as ProxyHost & { warnings?: string[] };
    throw new Error(res.error ?? "Update failed");
  }, []);

  const remove = useCallback(async (id: number) => {
    const res = await api.deleteRoute(id);
    if (!res.ok) throw new Error(res.error ?? "Delete failed");
  }, []);

  return { routeList, loading, error, refetch: fetchRoutes, create, update, remove };
}
