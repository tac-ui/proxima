"use client";

import React, { useEffect, useState } from "react";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import {
  Button,
  Input,
  Select,
  Combobox,
} from "@tac-ui/web";
import { Cloud, ArrowRight, Lock, Server } from "@tac-ui/icon";
import type { ProxyHost, DiscoveredServiceWithManaged, ListeningProcessWithManaged, CloudflaredStatus, ManagedService, CloudflareZone } from "@/types";

interface RouteFormProps {
  initial?: Partial<ProxyHost>;
  onSubmit: (data: Partial<ProxyHost>) => Promise<void>;
  submitting?: boolean;
  submitLabel?: string;
}

export function RouteForm({
  initial,
  onSubmit,
  submitting = false,
  submitLabel = "Save",
}: RouteFormProps) {
  const { connected } = useApiContext();
  const [domain, setDomain] = useState<string>(initial?.domainNames?.[0] ?? "");
  const [scheme, setScheme] = useState<"http" | "https">(initial?.forwardScheme ?? "http");
  const [forwardHost, setForwardHost] = useState(initial?.forwardHost ?? "");
  const [forwardPort, setForwardPort] = useState(String(initial?.forwardPort ?? "80"));
  const wsUpgrade = initial?.allowWebsocketUpgrade ?? true;
  const caching = initial?.cachingEnabled ?? false;
  const blockExploits = initial?.blockExploits ?? false;
  const [discoveredServices, setDiscoveredServices] = useState<DiscoveredServiceWithManaged[]>([]);
  const [listeningPorts, setListeningPorts] = useState<ListeningProcessWithManaged[]>([]);
  const [managedServices, setManagedServices] = useState<ManagedService[]>([]);
  const [targetValue, setTargetValue] = useState(
    initial?.forwardHost ? `manual:${initial.forwardHost}:${initial.forwardPort ?? 80}` : ""
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tunnelActive, setTunnelActive] = useState(false);
  const [cfdState, setCfdState] = useState<CloudflaredStatus["state"] | null>(null);
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [domainMode, setDomainMode] = useState<"manual" | "zone">("manual");
  const [selectedZone, setSelectedZone] = useState("");
  const [subdomainInput, setSubdomainInput] = useState("");

  useEffect(() => {
    if (!connected) return;
    api.discoverServices().then((res) => {
      if (res.ok && res.data) setDiscoveredServices(res.data);
    });
    api.getListeningPorts().then((res) => {
      if (res.ok && res.data) setListeningPorts(res.data);
    });
    api.getManagedServices().then((res) => {
      if (res.ok && res.data) setManagedServices(res.data);
    });
    api.getTunnelSettings().then((res) => {
      if (res.ok && res.data) setTunnelActive(res.data.enabled && !!res.data.tunnelId);
    }).catch(() => {});
    api.getCloudflaredStatus().then((res) => {
      if (res.ok && res.data) setCfdState(res.data.state);
    }).catch(() => {});
    api.getCloudflareSettings().then((res) => {
      if (res.ok && res.data && res.data.zones?.length) {
        const data = res.data;
        setCfZones(data.zones);
        const defaultZ = data.defaultZone && data.zones.some((z) => z.zoneName === data.defaultZone)
          ? data.defaultZone
          : data.zones[0].zoneName;
        setSelectedZone(defaultZ);
        setDomainMode("zone");
        // Pre-fill subdomain from existing domain when editing
        const existingDomain = initial?.domainNames?.[0];
        if (existingDomain) {
          const matchingZone = data.zones.find((z) => existingDomain.endsWith(`.${z.zoneName}`));
          if (matchingZone) {
            setSelectedZone(matchingZone.zoneName);
            setSubdomainInput(existingDomain.slice(0, -(matchingZone.zoneName.length + 1)));
          }
        }
      }
    }).catch(() => {});
  }, [connected]);

  /** Resolve the final domain string from current inputs */
  const resolveDomain = (): string => {
    if (domainMode === "zone" && selectedZone) {
      const sub = subdomainInput.trim();
      return sub ? `${sub}.${selectedZone}` : "";
    }
    return domain;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Use current input or existing domain
    const finalDomain = resolveDomain() || domain;
    setDomain(finalDomain);
    setSubdomainInput("");
    const errs: Record<string, string> = {};
    if (!finalDomain) errs.domains = "Domain is required";
    if (!forwardHost.trim()) errs.forwardHost = "Forward host is required";
    if (!forwardPort || isNaN(Number(forwardPort))) errs.forwardPort = "Valid port is required";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await onSubmit({
      domainNames: [finalDomain],
      forwardScheme: scheme,
      forwardHost: forwardHost.trim(),
      forwardPort: Number(forwardPort),
      allowWebsocketUpgrade: wsUpgrade,
      cachingEnabled: caching,
      blockExploits,
      enabled: true,
    });
  };

  const targetOptions = React.useMemo(() => {
    const hasManaged = managedServices.length > 0;

    // Filter services/processes by managed status (fallback to all if none managed)
    const filteredContainers = hasManaged
      ? discoveredServices.filter((svc) => svc.managed)
      : discoveredServices;
    const filteredProcesses = hasManaged
      ? listeningPorts.filter((p) => p.managed)
      : listeningPorts;

    const opts: { value: string; label: string }[] = [];
    for (const svc of filteredContainers) {
      if (svc.ports.length === 0) {
        opts.push({
          value: `docker:${svc.internalIp}:80`,
          label: `[${svc.stackName}] ${svc.serviceName} — ${svc.internalIp}`,
        });
      } else {
        for (const p of svc.ports) {
          opts.push({
            value: `docker:${svc.internalIp}:${p.containerPort}`,
            label: `[${svc.stackName}] ${svc.serviceName} — ${svc.internalIp}:${p.containerPort}`,
          });
        }
      }
    }
    for (const proc of filteredProcesses) {
      const addr = proc.address === "*" || proc.address === "0.0.0.0" || proc.address === "::" ? "127.0.0.1" : proc.address;
      opts.push({
        value: `host:${addr}:${proc.port}`,
        label: `[Host] ${proc.name} — :${proc.port}`,
      });
    }
    // Deduplicate by value
    const seen = new Set<string>();
    return opts.filter((o) => {
      if (seen.has(o.value)) return false;
      seen.add(o.value);
      return true;
    });
  }, [discoveredServices, listeningPorts, managedServices]);

  const handleTargetSelect = (value: string) => {
    setTargetValue(value);
    const parts = value.split(":");
    if (parts.length >= 3) {
      const host = parts.slice(1, -1).join(":");
      const port = parts[parts.length - 1];
      setForwardHost(host);
      setForwardPort(port);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Tunnel traffic flow */}
      {tunnelActive && cfdState === "running" && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/5 border border-success/20">
          <div className="flex items-center gap-2 text-xs font-medium flex-wrap">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Server size={12} />
              Client
            </span>
            <ArrowRight size={12} className="text-muted-foreground/50" />
            <span className="flex items-center gap-1 text-point">
              <Cloud size={12} />
              Cloudflare Edge
            </span>
            <span className="flex items-center gap-1 text-success">
              <Lock size={10} />
              SSL
            </span>
            <ArrowRight size={12} className="text-muted-foreground/50" />
            <span className="text-muted-foreground">Tunnel</span>
            <ArrowRight size={12} className="text-muted-foreground/50" />
            <span className="text-foreground font-semibold">Origin Service</span>
          </div>
        </div>
      )}

      {/* Domain Name */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Domain Name</p>
          {cfZones.length > 0 && (
            <button
              type="button"
              className="text-xs text-point hover:underline"
              onClick={() => setDomainMode((m) => m === "manual" ? "zone" : "manual")}
            >
              {domainMode === "manual" ? "Select from zones" : "Enter manually"}
            </button>
          )}
        </div>
        {domainMode === "zone" && cfZones.length > 0 ? (
          <div className="flex items-end gap-2">
            <Input
              value={subdomainInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setSubdomainInput(e.target.value);
                const sub = e.target.value.trim();
                if (selectedZone && sub) {
                  setDomain(`${sub}.${selectedZone}`);
                }
              }}
              placeholder="subdomain"
              className="flex-1"
              error={!!errors.domains}
            />
            <span className="flex items-center h-[var(--input-md-height)] text-sm text-muted-foreground pb-px">.</span>
            <Select
              options={cfZones.map((z) => ({ value: z.zoneName, label: z.zoneName }))}
              value={selectedZone}
              onChange={(v: string) => {
                setSelectedZone(v);
                const sub = subdomainInput.trim();
                if (sub) setDomain(`${sub}.${v}`);
              }}
              className="!h-[var(--input-md-height)]"
            />
          </div>
        ) : (
          <Input
            value={domain}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDomain(e.target.value)}
            placeholder="example.com"
            error={!!errors.domains}
          />
        )}
        {domain && (
          <p className="text-xs text-muted-foreground">
            {domain}
          </p>
        )}
        {errors.domains && <p className="text-xs text-error">{errors.domains}</p>}
      </div>

      {/* Forward target */}
      <div className="space-y-3">
        <p className="text-sm font-medium">Origin Service</p>
        {tunnelActive && (
          <p className="text-xs text-muted-foreground -mt-1">
            SSL is terminated at Cloudflare Edge — use <code className="text-xs px-1 py-0.5 rounded bg-muted">http</code> for local services. <code className="text-xs px-1 py-0.5 rounded bg-muted">localhost</code> is automatically resolved to the Proxima container.
          </p>
        )}
        {targetOptions.length > 0 && (
          <Combobox
            options={targetOptions}
            value={targetValue}
            onChange={handleTargetSelect}
            placeholder="Search services or ports..."
            emptyText="No services found"
          />
        )}
        <div className="grid grid-cols-[auto_1fr_auto] gap-3">
          <Select
            options={[
              { value: "http", label: "http" },
              { value: "https", label: "https" },
            ]}
            value={scheme}
            onChange={(v: string) => setScheme(v as "http" | "https")}
            className="!h-[var(--input-md-height)] min-w-[100px]"
          />
          <Input
            value={forwardHost}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForwardHost(e.target.value)}
            placeholder="192.168.1.100 or container-name"
            error={!!errors.forwardHost}
            errorMessage={errors.forwardHost}
          />
          <Input
            value={forwardPort}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForwardPort(e.target.value)}
            placeholder="80"
            className="w-24"
            error={!!errors.forwardPort}
            errorMessage={errors.forwardPort}
          />
        </div>
      </div>


      <Button type="submit" disabled={submitting} className="w-full justify-center">
        {submitting ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
