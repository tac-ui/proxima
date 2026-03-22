"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  Input,
  EmptyState,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Chip,
  Button,
  SegmentController,
  Tooltip,
  Indicator,
  pageEntrance,
  useToast,
} from "@tac-ui/web";
import { Server, Search, RefreshCw, Terminal, AlertTriangle, Star } from "@tac-ui/icon";
import { CopyButton } from "@/components/shared/CopyButton";
import type { DiscoveredServiceWithManaged, ListeningProcessWithManaged, MountInfo } from "@/types";

type TabValue = "containers" | "processes";

const tabOptions = [
  { value: "containers", label: "Containers" },
  { value: "processes", label: "Processes" },
];

export default function ServersPage() {
  const { connected, subscribe } = useApiContext();
  const { toast } = useToast();
  const [tab, setTab] = useState<TabValue>("containers");

  // Docker status
  const [dockerConnected, setDockerConnected] = useState<boolean | null>(null);
  const [dockerChecking, setDockerChecking] = useState(true);

  const checkDocker = useCallback(async () => {
    setDockerChecking(true);
    try {
      const res = await api.getDockerStatus();
      setDockerConnected(res.ok && res.data ? res.data.connected : false);
    } catch {
      setDockerConnected(false);
    }
    setDockerChecking(false);
  }, []);

  useEffect(() => {
    checkDocker();
  }, [checkDocker]);

  // Containers state
  const [services, setServices] = useState<DiscoveredServiceWithManaged[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [portStatus, setPortStatus] = useState<Record<number, boolean>>({});
  const [checkingPorts, setCheckingPorts] = useState(false);

  // Processes state
  const [processes, setProcesses] = useState<ListeningProcessWithManaged[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(true);

  // Managed toggle handler
  const toggleContainerManaged = useCallback(async (svc: DiscoveredServiceWithManaged) => {
    if (svc.managed && svc.managedId != null) {
      const res = await api.removeManagedService(svc.managedId);
      if (res.ok) {
        setServices((prev) =>
          prev.map((s) =>
            s.containerName === svc.containerName ? { ...s, managed: false, managedId: undefined } : s
          )
        );
      } else {
        toast("Failed to update", { variant: "error" });
      }
    } else {
      const identifier = `${svc.stackName}/${svc.serviceName}`;
      const res = await api.addManagedService("container", identifier);
      if (res.ok && res.data) {
        setServices((prev) =>
          prev.map((s) =>
            s.containerName === svc.containerName ? { ...s, managed: true, managedId: res.data!.id } : s
          )
        );
      } else {
        toast("Failed to update", { variant: "error" });
      }
    }
  }, [toast]);

  const toggleProcessManaged = useCallback(async (proc: ListeningProcessWithManaged) => {
    if (proc.managed && proc.managedId != null) {
      const res = await api.removeManagedService(proc.managedId);
      if (res.ok) {
        setProcesses((prev) =>
          prev.map((p) =>
            p.pid === proc.pid && p.port === proc.port ? { ...p, managed: false, managedId: undefined } : p
          )
        );
      } else {
        toast("Failed to update", { variant: "error" });
      }
    } else {
      const identifier = `${proc.name}:${proc.port}`;
      const res = await api.addManagedService("process", identifier);
      if (res.ok && res.data) {
        setProcesses((prev) =>
          prev.map((p) =>
            p.pid === proc.pid && p.port === proc.port ? { ...p, managed: true, managedId: res.data!.id } : p
          )
        );
      } else {
        toast("Failed to update", { variant: "error" });
      }
    }
  }, [toast]);

  const [search, setSearch] = useState("");


  const fetchServices = useCallback(async (silent = false) => {
    if (!silent) setLoadingServices(true);
    try {
      const res = await api.discoverServices();
      if (res.ok && res.data) {
        setServices(res.data);
        // Inline port check to avoid dependency cycle
        const allPorts = res.data
          .flatMap((s) => s.ports)
          .filter((p, i, arr) => arr.findIndex((x) => x.hostPort === p.hostPort) === i)
          .map((p) => ({ port: p.hostPort }));
        if (allPorts.length > 0) {
          if (!silent) setCheckingPorts(true);
          const portRes = await api.checkPorts(allPorts);
          if (portRes.ok && portRes.data) {
            setPortStatus(portRes.data.results);
          }
          if (!silent) setCheckingPorts(false);
        }
      } else {
        if (!silent) toast(res.error ?? "Failed to load services", { variant: "error" });
      }
    } catch (err) {
      if (!silent) toast(err instanceof Error ? err.message : "Failed to load services", { variant: "error" });
    }
    if (!silent) setLoadingServices(false);
  }, [toast]);

  const fetchProcesses = useCallback(async () => {
    setLoadingProcesses(true);
    try {
      const res = await api.getListeningPorts();
      if (res.ok && res.data) {
        setProcesses(res.data);
      } else {
        toast(res.error ?? "Failed to load processes", { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load processes", { variant: "error" });
    }
    setLoadingProcesses(false);
  }, [toast]);

  useEffect(() => {
    if (connected) fetchServices();
  }, [connected, fetchServices]);

  useEffect(() => {
    if (connected) fetchProcesses();
  }, [connected, fetchProcesses]);

  // Subscribe to real-time container updates via SSE (stable ref to avoid re-subscription loops)
  const fetchServicesRef = useRef(fetchServices);
  fetchServicesRef.current = fetchServices;
  useEffect(() => {
    const unsub = subscribe("discoveredServices", () => {
      fetchServicesRef.current(true);
    });
    return unsub;
  }, [subscribe]);

  const handleRefresh = () => {
    if (tab === "containers") fetchServices();
    else fetchProcesses();
  };

  // Containers filtering
  const filteredServices = services.filter((svc) =>
    svc.serviceName.toLowerCase().includes(search.toLowerCase()) ||
    svc.stackName.toLowerCase().includes(search.toLowerCase()) ||
    svc.containerName.toLowerCase().includes(search.toLowerCase()) ||
    svc.internalIp.includes(search)
  );

  // Sort: proxima stack first, then within stack proxima container first, proxima-cloudflared second
  const sortedServices = [...filteredServices].sort((a, b) => {
    // Stack-level: proxima first
    if (a.stackName === "proxima" && b.stackName !== "proxima") return -1;
    if (a.stackName !== "proxima" && b.stackName === "proxima") return 1;
    if (a.stackName !== b.stackName) return a.stackName.localeCompare(b.stackName);
    // Within same stack: proxima container first, proxima-cloudflared second
    const order = (name: string) =>
      name === "proxima" ? 0 : name === "proxima-cloudflared" ? 1 : 2;
    return order(a.containerName) - order(b.containerName);
  });

  // Processes filtering
  const filteredProcesses = processes.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.user.toLowerCase().includes(search.toLowerCase()) ||
    p.port.toString().includes(search) ||
    p.address.includes(search) ||
    p.pid.toString().includes(search)
  );

  const loading = tab === "containers" ? loadingServices : loadingProcesses;

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      <h1 className="text-xl font-bold">Servers</h1>
      {/* Top bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <SegmentController
          size="sm"
          options={tabOptions}
          value={tab}
          onChange={(v) => { setTab(v as TabValue); setSearch(""); }}
        />
        <div className="flex-1 min-w-[200px] max-w-96">
          <Input
            size="sm"
            placeholder={tab === "containers" ? "Search services..." : "Search processes..."}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            leftIcon={<Search size={16} />}
            disabled={tab === "containers" && !dockerConnected}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          leftIcon={<RefreshCw size={14} />}
          disabled={loading || (tab === "containers" && !dockerConnected)}
        >
          Refresh
        </Button>
      </div>

      {(dockerConnected === null || loading) && <Indicator variant="linear" />}

      {tab === "containers" ? (
        /* Containers tab */
        <AnimatePresence mode="wait">
          {dockerConnected === null ? (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} height={120} />
              ))}
            </motion.div>
          ) : dockerConnected === false ? (
            <motion.div
              key="docker-error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="flex flex-col items-center justify-center py-16"
            >
              <div className="flex flex-col items-center gap-4 max-w-md text-center">
                <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle size={28} className="text-destructive" />
                </div>
                <h2 className="text-lg font-bold">Docker Not Connected</h2>
                <p className="text-sm text-muted-foreground">
                  Unable to connect to Docker daemon. Make sure Docker is installed and running on this machine.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={checkDocker}
                  loading={dockerChecking}
                  leftIcon={dockerChecking ? undefined : <RefreshCw size={14} />}
                >
                  {dockerChecking ? "Checking..." : "Retry"}
                </Button>
              </div>
            </motion.div>
          ) : loadingServices ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} height={120} />
              ))}
            </motion.div>
          ) : sortedServices.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <EmptyState
                icon={<Server size={32} className="text-muted-foreground" />}
                title={search ? "No services found" : "No running services"}
                description={
                  search
                    ? `No services match "${search}"`
                    : "Deploy a stack to see running services here."
                }
                action={
                  !search ? (
                    <Link href="/stacks">
                      <Button>Go to Stacks</Button>
                    </Link>
                  ) : undefined
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto overflow-y-visible">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10 pl-4 pr-0"></TableHead>
                          <TableHead className="min-w-[100px]">Stack</TableHead>
                          <TableHead className="min-w-[120px]">Service</TableHead>
                          <TableHead className="min-w-[160px]">Container</TableHead>
                          <TableHead className="min-w-[120px]">IP</TableHead>
                          <TableHead className="min-w-[100px]">Ports</TableHead>
                          <TableHead className="min-w-[140px]">Networks</TableHead>
                          <TableHead className="min-w-[180px]">Volumes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedServices.map((svc) => (
                          <TableRow key={svc.containerName} className="group">
                            <TableCell className="pl-4 pr-0">
                              <Tooltip content={svc.managed ? "Tracked — shown in Routes" : "Track this service"} placement="top">
                                <button
                                  onClick={() => toggleContainerManaged(svc)}
                                  aria-label={svc.managed ? "Remove from managed" : "Add to managed"}
                                  className="p-1 rounded hover:bg-muted transition-colors"
                                >
                                  <Star
                                    size={14}
                                    className={svc.managed ? "text-warning fill-warning" : "text-muted-foreground"}
                                  />
                                </button>
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/stacks/${svc.stackName}`}
                                className="font-semibold text-sm hover:text-point transition-colors whitespace-nowrap"
                              >
                                {svc.stackName}
                              </Link>
                            </TableCell>
                            <TableCell>
                              <span className="font-medium text-sm whitespace-nowrap">{svc.serviceName}</span>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground whitespace-nowrap">
                                {svc.containerName}
                                <CopyButton value={svc.containerName} label="container" />
                              </span>
                            </TableCell>
                            <TableCell>
                              {svc.internalIp ? (
                                <span className="inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap">
                                  {svc.internalIp}
                                  <CopyButton value={svc.internalIp} label="IP" />
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {svc.ports.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {svc.ports
                                    .filter((p, i, arr) => arr.findIndex((x) => x.hostPort === p.hostPort && x.containerPort === p.containerPort) === i)
                                    .map((p) => {
                                      const status = portStatus[p.hostPort];
                                      const isUp = status === true;
                                      const isDown = status === false;
                                      return (
                                        <Tooltip key={`${p.hostPort}:${p.containerPort}`} content={isUp ? "Port reachable" : isDown ? "Port not reachable" : "Checking..."} placement="top">
                                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono border transition-colors ${isUp ? "border-success/30 bg-success/10 text-success" : isDown ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-surface text-muted-foreground"}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${isUp ? "bg-success" : isDown ? "bg-destructive" : "bg-muted-foreground animate-pulse"}`} />
                                            {p.hostPort}:{p.containerPort}
                                          </span>
                                        </Tooltip>
                                      );
                                    })}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {svc.networks.map((n) => (
                                  <Chip key={n} variant="filter">{n}</Chip>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              {svc.mounts && svc.mounts.length > 0 ? (
                                <div className="space-y-0.5 max-w-[280px]">
                                  {svc.mounts.map((m: MountInfo, i: number) => (
                                    <Tooltip key={i} content={`${m.source} → ${m.destination}${!m.rw ? " (ro)" : ""}`} placement="top">
                                      <div className="font-mono text-[11px] text-muted-foreground truncate whitespace-nowrap">
                                        {m.destination}{!m.rw ? " (ro)" : ""}
                                      </div>
                                    </Tooltip>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        /* Processes tab */
        loadingProcesses ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        ) : filteredProcesses.length === 0 ? (
          <EmptyState
            icon={<Terminal size={32} className="text-muted-foreground" />}
            title={search ? "No processes found" : "No listening processes"}
            description={
              search
                ? `No processes match "${search}"`
                : "No TCP listening processes detected on this host."
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 pl-4 pr-0"></TableHead>
                      <TableHead className="min-w-[120px]">Process</TableHead>
                      <TableHead className="min-w-[100px]">Alias</TableHead>
                      <TableHead className="min-w-[70px]">PID</TableHead>
                      <TableHead className="min-w-[80px]">Port</TableHead>
                      <TableHead className="min-w-[120px]">Address</TableHead>
                      <TableHead className="min-w-[80px]">User</TableHead>
                      <TableHead className="min-w-[80px]">Protocol</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProcesses.map((p) => (
                      <TableRow key={`${p.pid}:${p.port}`}>
                        <TableCell className="pl-4 pr-0">
                          <Tooltip content={p.managed ? "Tracked — shown in Routes" : "Track this port"} placement="top">
                            <button
                              onClick={() => toggleProcessManaged(p)}
                              aria-label={p.managed ? "Remove from managed" : "Add to managed"}
                              className="p-1 rounded hover:bg-muted transition-colors"
                            >
                              <Star
                                size={14}
                                className={p.managed ? "text-warning fill-warning" : "text-muted-foreground"}
                              />
                            </button>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium text-sm whitespace-nowrap">{p.name}</span>
                        </TableCell>
                        <TableCell>
                          {p.managed && p.managedId ? (
                            <input
                              className="w-full bg-transparent text-xs border-b border-transparent hover:border-border focus:border-point focus:outline-none py-0.5 placeholder:text-muted-foreground/50"
                              defaultValue={p.alias ?? ""}
                              placeholder="Set alias..."
                              onBlur={(e) => {
                                const val = e.target.value.trim() || null;
                                if (val !== (p.alias ?? null)) {
                                  api.updateManagedService(p.managedId!, { alias: val });
                                  setProcesses((prev) =>
                                    prev.map((proc) =>
                                      proc.pid === p.pid && proc.port === p.port ? { ...proc, alias: val } : proc
                                    )
                                  );
                                }
                              }}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                            />
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">{p.pid}</span>
                        </TableCell>
                        <TableCell>
                          <Chip variant="filter">{p.port}</Chip>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 font-mono text-xs whitespace-nowrap">
                            {p.address}
                            <CopyButton value={`${p.address === "*" || p.address === "0.0.0.0" ? "127.0.0.1" : p.address}:${p.port}`} label="address" />
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{p.user || "-"}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{p.protocol}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )
      )}
    </motion.div>
  );
}
