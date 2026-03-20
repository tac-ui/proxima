"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useRoutes } from "@/hooks/useRoutes";
import { RouteCard } from "@/components/routes/RouteCard";
import { api } from "@/lib/api";
import { Button, Input, EmptyState, Skeleton, Indicator, pageEntrance, fadeVariants, tacSpring } from "@tac-ui/web";
import { Plus, Globe, Search, Cloud, Settings } from "@tac-ui/icon";
import { useAuth } from "@/contexts/AuthContext";
import type { CloudflaredStatus } from "@/types";

const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06 },
  },
};

const cardItem = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: tacSpring.entrance,
  },
};

export default function RoutesPage() {
  const { isManager } = useAuth();
  const { routeList, loading, remove } = useRoutes();
  const [search, setSearch] = useState("");
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelChecked, setTunnelChecked] = useState(false);
  const [cfdState, setCfdState] = useState<CloudflaredStatus["state"] | null>(null);

  useEffect(() => {
    Promise.all([
      api.getTunnelSettings(),
      api.getCloudflaredStatus(),
    ]).then(([tunRes, cfdRes]) => {
      const cfdRunning = cfdRes.ok && cfdRes.data?.state === "running";
      if (tunRes.ok && tunRes.data) {
        setTunnelActive((tunRes.data.enabled && !!tunRes.data.tunnelId) || cfdRunning);
      } else if (cfdRunning) {
        setTunnelActive(true);
      }
      if (cfdRes.ok && cfdRes.data) setCfdState(cfdRes.data.state);
      setTunnelChecked(true);
    }).catch(() => { setTunnelChecked(true); });
  }, []);

  const filtered = routeList.filter((h) =>
    h.domainNames.some((d) => d.toLowerCase().includes(search.toLowerCase())) ||
    h.forwardHost.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Tunnel status banner */}
      <AnimatePresence>
        {cfdState !== null && cfdState !== "running" && (
          <motion.div
            variants={fadeVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border bg-warning/5 border-warning/20"
          >
            <div className="flex items-center gap-3">
              <Cloud size={16} className="text-warning" />
              <div>
                <p className="text-sm font-medium">
                  {tunnelActive
                    ? "Cloudflare Tunnel Enabled but Not Running"
                    : "Cloudflare Tunnel Not Configured"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tunnelActive
                    ? "The cloudflared connector is not running. Check Settings."
                    : "Enable tunnel in Settings to route traffic through Cloudflare."}
                </p>
              </div>
            </div>
            <Link href="/cloudflare">
              <Button variant="secondary" size="sm" leftIcon={<Settings size={14} />}>
                Cloudflare Settings
              </Button>
            </Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-96">
          <Input
            size="sm"
            placeholder="Search domains..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            leftIcon={<Search size={16} />}
          />
        </div>
        {isManager && (
          <Link href="/routes/new">
            <Button size="sm" leftIcon={<Plus size={14} />}>
              Add Route
            </Button>
          </Link>
        )}
      </div>

      {loading && <Indicator variant="linear" />}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div variants={fadeVariants} initial="hidden" animate="visible">
          <EmptyState
            icon={<Globe size={32} className={tunnelChecked && !tunnelActive ? "text-warning" : "text-success"} />}
            title={search ? "No routes found" : tunnelChecked && !tunnelActive ? "Cloudflare Tunnel Not Configured" : "No routes configured"}
            description={
              search
                ? `No routes match "${search}"`
                : tunnelChecked && !tunnelActive
                  ? "Configure Cloudflare Tunnel first to start routing traffic."
                  : "Add a route to map domains to your services."
            }
            action={
              !search && isManager ? (
                tunnelChecked && !tunnelActive ? (
                  <Link href="/cloudflare">
                    <Button leftIcon={<Settings size={14} />}>Configure Tunnel</Button>
                  </Link>
                ) : (
                  <Link href="/routes/new">
                    <Button>Add First Route</Button>
                  </Link>
                )
              ) : undefined
            }
          />
        </motion.div>
      ) : (
        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {filtered.map((host) => (
            <motion.div key={host.id} variants={cardItem}>
              <RouteCard host={host} tunnelActive={tunnelActive} onDelete={remove} isManager={isManager} />
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}
