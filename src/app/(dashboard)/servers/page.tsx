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
} from "@tac-ui/web";
import { Server, Search, RefreshCw, Terminal, AlertTriangle, Star } from "@tac-ui/icon";
import { CopyButton } from "@/components/shared/CopyButton";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import type { DiscoveredServiceWithManaged, ListeningProcessWithManaged, MountInfo } from "@/types";

type TabValue = "containers" | "processes";

const tabOptions = [
  { value: "containers", label: "Containers" },
  { value: "processes", label: "Processes" },
];

export default function ServersPage() {
  const { connected } = useApiContext();
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
      }
    }
  }, []);

  const toggleProcessManaged = useCallback(async (proc: ListeningProcessWithManaged) => {
    if (proc.managed && proc.managedId != null) {
      const res = await api.removeManagedService(proc.managedId);
      if (res.ok) {
        setProcesses((prev) =>
          prev.map((p) =>
            p.pid === proc.pid && p.port === proc.port ? { ...p, managed: false, managedId: undefined } : p
          )
        );
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
      }
    }
  }, []);

  const [search, setSearch] = useState("");

  const fetchServices = useCallback(async () => {
    setLoadingServices(true);
    const res = await api.discoverServices();
    if (res.ok && res.data) {
      setServices(res.data);
    }
    setLoadingServices(false);
  }, []);

  const fetchProcesses = useCallback(async () => {
    setLoadingProcesses(true);
    const res = await api.getListeningPorts();
    if (res.ok && res.data) {
      setProcesses(res.data);
    }
    setLoadingProcesses(false);
  }, []);

  useEffect(() => {
    if (connected) fetchServices();
  }, [connected, fetchServices]);

  useEffect(() => {
    if (connected) fetchProcesses();
  }, [connected, fetchProcesses]);

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
    <div className="space-y-6">
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
            inputSize="sm"
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

      <LoadingIndicator visible={dockerConnected === null || loading} />

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
                  disabled={dockerChecking}
                  leftIcon={<RefreshCw size={14} className={dockerChecking ? "animate-spin" : ""} />}
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
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Stack</TableHead>
                        <TableHead>Service</TableHead>
                        <TableHead>Container</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Ports</TableHead>
                        <TableHead>Volumes</TableHead>
                        <TableHead>Networks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedServices.map((svc) => (
                        <TableRow key={svc.containerName}>
                          <TableCell>
                            <Tooltip content={svc.managed ? "Managed" : "Add to managed"} placement="top">
                              <button
                                onClick={() => toggleContainerManaged(svc)}
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
                              className="text-sm font-semibold hover:text-point transition-colors"
                            >
                              {svc.stackName}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <span className="font-medium">{svc.serviceName}</span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                              {svc.containerName}
                              <CopyButton value={svc.containerName} label="container" />
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 font-mono text-xs">
                              {svc.internalIp}
                              <CopyButton value={svc.internalIp} label="IP" />
                            </span>
                          </TableCell>
                          <TableCell>
                            {svc.ports.length > 0 ? (
                              <div className="font-mono text-xs space-y-0.5">
                                {svc.ports.map((p) => (
                                  <div key={`${p.hostPort}:${p.containerPort}`}>
                                    {p.hostPort}:{p.containerPort}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {svc.mounts && svc.mounts.length > 0 ? (
                              <div className="font-mono text-xs space-y-0.5">
                                {svc.mounts.map((m: MountInfo, i: number) => (
                                  <div key={i}>
                                    {m.source} → {m.destination}{!m.rw ? " (ro)" : ""}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="font-mono text-xs space-y-0.5">
                              {svc.networks.map((n) => (
                                <div key={n}>{n}</div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>PID</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Protocol</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProcesses.map((p) => (
                    <TableRow key={`${p.pid}:${p.port}`}>
                      <TableCell>
                        <Tooltip content={p.managed ? "Managed" : "Add to managed"} placement="top">
                          <button
                            onClick={() => toggleProcessManaged(p)}
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
                        <span className="font-mono text-xs">{p.pid}</span>
                      </TableCell>
                      <TableCell>
                        <Tooltip content={p.name} placement="top">
                          <span className="font-medium">{p.name}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{p.user}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{p.address}</span>
                      </TableCell>
                      <TableCell>
                        <Chip variant="filter">{p.port}</Chip>
                      </TableCell>
                      <TableCell>
                        <Chip variant="filter">{p.protocol}</Chip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      )}
    </div>
  );
}
