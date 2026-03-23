"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, Tooltip } from "@tac-ui/web";
import { ExternalLink, Cloud, ArrowRight, Trash2, Edit, BarChart3 } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import type { ProxyHost } from "@/types";

interface DomainCheckResult {
  status: "up" | "down";
  statusCode?: number;
  responseTime: number;
}

interface RouteCardProps {
  host: ProxyHost;
  tunnelActive?: boolean;
  onDelete?: (id: number) => Promise<void>;
  isManager?: boolean;
  domainStatus?: Record<string, DomainCheckResult>;
}

export function RouteCard({ host, tunnelActive, onDelete, isManager, domainStatus = {} }: RouteCardProps) {
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();

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
              <StatusDot result={domainStatus[`https://${primaryDomain}`]} />
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
                  <StatusDot result={domainStatus[`https://${d}`]} />
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

function StatusDot({ result }: { result?: DomainCheckResult }) {
  const color = result?.status === "up" ? "bg-success" : result?.status === "down" ? "bg-destructive" : "bg-muted-foreground animate-pulse";
  const label = result?.status === "up"
    ? `${result.statusCode ?? "OK"} · ${result.responseTime}ms`
    : result?.status === "down"
      ? `Down${result.statusCode ? ` · ${result.statusCode}` : ""}`
      : "Checking...";
  return (
    <Tooltip content={label} placement="top">
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
    </Tooltip>
  );
}
