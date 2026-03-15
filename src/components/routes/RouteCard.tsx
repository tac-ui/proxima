"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardContent, CardFooter, Chip } from "@tac-ui/web";
import { ChevronRight, BarChart3, Cloud, ArrowRight } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { CopyButton } from "@/components/shared/CopyButton";
import type { ProxyHost } from "@/types";

interface RouteCardProps {
  host: ProxyHost;
  tunnelActive?: boolean;
  onDelete?: (id: number) => Promise<void>;
  isManager?: boolean;
}

export function RouteCard({ host, tunnelActive, onDelete, isManager }: RouteCardProps) {
  const [deleting, setDeleting] = useState(false);
  const confirm = useConfirm();

  const handleDelete = async () => {
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

  return (
    <Card interactive>
      <CardContent>
        {/* Domains */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1 mb-1">
              {host.domainNames.map((d) => (
                <Chip key={d} variant="filter">
                  <span className="font-mono">{d}</span>
                  <CopyButton value={d} label="domain" />
                </Chip>
              ))}
            </div>
          </div>
          <Badge variant={host.enabled ? "success" : "destructive"}>
            {host.enabled ? "Online" : "Offline"}
          </Badge>
        </div>

        {/* Target / Traffic flow */}
        <div className="flex items-center gap-1.5 mb-4 text-xs text-muted-foreground flex-wrap">
          {tunnelActive ? (
            <>
              <Cloud size={12} className="text-point shrink-0" />
              <span className="text-point font-medium">CF</span>
              <ArrowRight size={10} className="text-muted-foreground/50 shrink-0" />
              <span className="font-mono truncate">{target}</span>
            </>
          ) : (
            <>
              <ChevronRight size={14} className="shrink-0" />
              <span className="font-mono truncate">{target}</span>
            </>
          )}
          <CopyButton value={target} label="forward target" />
        </div>

        {/* Features */}
        <div className="flex flex-wrap gap-2 mb-4">
          {tunnelActive && (
            <Chip variant="filter" leftIcon={<Cloud size={10} />}>Tunnel</Chip>
          )}
          {host.allowWebsocketUpgrade && <Chip variant="filter">WS</Chip>}
          {host.http2Support && <Chip variant="filter">HTTP/2</Chip>}
          {host.cachingEnabled && <Chip variant="filter">Cache</Chip>}
        </div>
      </CardContent>

      {/* Actions */}
      <CardFooter>
        <div className="flex gap-2">
          <Link href={`/analytics?hostId=${host.id}`}>
            <Button variant="ghost" size="sm">
              <BarChart3 size={14} />
            </Button>
          </Link>
          {isManager !== false && (
            <>
              <Link href={`/routes/${host.id}/edit`}>
                <Button variant="secondary" size="sm">Edit</Button>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
