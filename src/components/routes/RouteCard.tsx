"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, Tooltip } from "@tac-ui/web";
import { ExternalLink, Cloud, ArrowRight, Trash2, Edit, BarChart3 } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import type { ProxyHost } from "@/types";

interface RouteCardProps {
  host: ProxyHost;
  tunnelActive?: boolean;
  onDelete?: (id: number) => Promise<void>;
  isManager?: boolean;
}

type DomainStatus = "checking" | "up" | "down";

export function RouteCard({ host, tunnelActive, onDelete, isManager }: RouteCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [domainStatus, setDomainStatus] = useState<Record<string, DomainStatus>>({});
  const confirm = useConfirm();

  useEffect(() => {
    if (!host.enabled) return;
    const init: Record<string, DomainStatus> = {};
    for (const d of host.domainNames) init[d] = "checking";
    setDomainStatus(init);

    for (const domain of host.domainNames) {
      fetch(`https://${domain}`, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(8000) })
        .then(() => setDomainStatus((prev) => ({ ...prev, [domain]: "up" })))
        .catch(() => setDomainStatus((prev) => ({ ...prev, [domain]: "down" })));
    }
  }, [host.domainNames, host.enabled]);

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onDelete) return;
    const ok = await confirm({
      title: "Delete Route",
      message: `Delete route for ${host.domainNames.join(", ")}? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await onDelete(host.id);
    } finally {
      setDeleting(false);
    }
  };

  const target = `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`;
  const primaryDomain = host.domainNames[0] ?? "";
  const extraDomains = host.domainNames.slice(1);

  return (
    <Link href={`/routes/${host.id}/edit`} className="block group">
      <Card className="h-full transition-all duration-200 group-hover:border-point/30 group-hover:shadow-md">
        <CardContent className="p-5">
          {/* Header: Status + Features */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Badge variant={host.enabled ? "success" : "destructive"}>
                {host.enabled ? "Online" : "Offline"}
              </Badge>
              {tunnelActive && (
                <Badge variant="secondary">
                  <Cloud size={10} className="mr-1" />
                  Tunnel
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              {host.allowWebsocketUpgrade && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">WS</span>}
              {host.cachingEnabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Cache</span>}
              {host.http2Support && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">H2</span>}
            </div>
          </div>

          {/* Primary Domain */}
          <div className="mb-1">
            <a
              href={`https://${primaryDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-sm font-semibold hover:text-point transition-colors"
            >
              <StatusDot status={domainStatus[primaryDomain]} />
              {primaryDomain}
              <ExternalLink size={12} className="text-muted-foreground" />
            </a>
          </div>

          {/* Extra domains */}
          {extraDomains.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {extraDomains.map((d) => (
                <a
                  key={d}
                  href={`https://${d}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-point transition-colors"
                >
                  <StatusDot status={domainStatus[d]} />
                  {d}
                </a>
              ))}
            </div>
          )}

          {/* Origin */}
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border/50">
            <ArrowRight size={12} className="text-muted-foreground/50 shrink-0" />
            <span className="font-mono text-xs text-muted-foreground truncate">{target}</span>
          </div>

          {/* Actions */}
          {isManager !== false && (
            <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border/50">
              <Link href={`/analytics?hostId=${host.id}`} onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" iconOnly title="Analytics">
                  <BarChart3 size={13} />
                </Button>
              </Link>
              <Link href={`/routes/${host.id}/edit`} onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" iconOnly title="Edit">
                  <Edit size={13} />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                title="Delete"
                disabled={deleting}
                onClick={handleDelete}
              >
                <Trash2 size={13} className="text-destructive" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function StatusDot({ status }: { status?: DomainStatus }) {
  const color = status === "up" ? "bg-success" : status === "down" ? "bg-destructive" : "bg-muted-foreground animate-pulse";
  const label = status === "up" ? "Reachable" : status === "down" ? "Unreachable" : "Checking...";
  return (
    <Tooltip content={label} placement="top">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
    </Tooltip>
  );
}
