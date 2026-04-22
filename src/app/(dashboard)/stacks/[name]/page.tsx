"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
import { motion } from "framer-motion";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardContent,
  Input,
  Tabs,
  TabsList,
  TabTrigger,
  TabContent,
  Textarea,
  Skeleton,
  EmptyState,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { ComposeEditor } from "@/components/stacks/ComposeEditor";
import { LogViewer } from "@/components/stacks/LogViewer";
import { ChevronLeft, Play, Square, RotateCw, Trash2, Box, FileText, Plus, ScrollText } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/contexts/AuthContext";
import { CopyButton } from "@/components/shared/CopyButton";
import type { Stack, ContainerInfo, MountInfo, NetworkInfo } from "@/types";
import { statusVariantMap, statusLabelMap } from "@/lib/stack-constants";

export default function StackDetailPage() {
  const params = useParams();
  const router = useRouter();
  const name = params.name as string;
  const { connected, subscribe } = useApiContext();
  const { isManager } = useAuth();

  const [stack, setStack] = useState<Stack | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("compose");
  const [yaml, setYaml] = useState("");
  const [env, setEnv] = useState("");
  const [dockerfiles, setDockerfiles] = useState<Record<string, string>>({});
  const [newDockerfileName, setNewDockerfileName] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();

  const fetchStack = useCallback(() => {
    setLoading(true);
    api.getStack(name).then((res) => {
      setLoading(false);
      if (res.ok && res.data) {
        setStack(res.data);
        setYaml(res.data.composeYAML);
        setEnv(res.data.composeENV);
        setDockerfiles(res.data.dockerfiles ?? {});
      } else {
        toast(res.error ?? "Failed to load stack", { variant: "error" });
      }
    });
  }, [name]);

  useEffect(() => {
    if (connected) fetchStack();
  }, [connected, fetchStack]);

  useEffect(() => {
    const handleStatus = (data: { name: string; status: string }) => {
      if (data.name === name) fetchStack();
    };
    const unsub = subscribe("stackStatus", handleStatus);
    return unsub;
  }, [name, fetchStack, subscribe]);

  const handleAction = async (action: "start" | "stop" | "restart" | "delete") => {
    setActionLoading(action);

    if (action === "delete") {
      const ok = await confirm({
        title: "Delete Stack",
        message: `Delete stack "${name}"? This cannot be undone.`,
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!ok) { setActionLoading(null); return; }
      api.deleteStack(name).then((res) => {
        setActionLoading(null);
        if (res.ok) {
          toast("Stack deleted", { variant: "success" });
          router.push("/stacks");
        } else {
          toast(res.error ?? "Delete failed", { variant: "error" });
        }
      });
      return;
    }

    const actionMap = {
      start: () => api.startStack(name),
      stop: () => api.stopStack(name),
      restart: () => api.restartStack(name),
    } as const;

    actionMap[action]().then((res) => {
      setActionLoading(null);
      if (res.ok) {
        toast(`Stack ${action}ed successfully`, { variant: "success" });
        fetchStack();
      } else {
        toast(res.error ?? `${action} failed`, { variant: "error" });
      }
    });
  };

  const handleDeploy = async () => {
    setSaveLoading(true);
    api.deployStack(name, yaml, env, false, dockerfiles).then((res) => {
      setSaveLoading(false);
      if (res.ok) {
        toast("Stack deployed successfully", { variant: "success" });
        fetchStack();
      } else {
        toast(res.error ?? "Deploy failed", { variant: "error" });
      }
    });
  };

  const [rightTab, setRightTab] = useState("logs");

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton height={48} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton height={384} />
          <Skeleton height={384} />
        </div>
      </div>
    );
  }

  // Prevent stopping/deleting the Proxima stack itself
  const isSelfStack = stack?.containers.some((c) => c.name === "proxima") ?? false;

  if (!stack && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Stack not found or failed to load.</p>
        <Button variant="secondary" onClick={() => router.push("/stacks")}>Back to Stacks</Button>
      </div>
    );
  }

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => router.push("/stacks")}
          >
            <ChevronLeft size={20} />
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <h1 className="text-lg sm:text-xl font-bold truncate">{name}</h1>
              {stack && (
                <Badge variant={statusVariantMap[stack.status] ?? "secondary"}>
                  {statusLabelMap[stack.status] ?? stack.status}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {isManager && !isSelfStack && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              disabled={actionLoading !== null || stack?.status === "running"}
              onClick={() => handleAction("start")}
              leftIcon={<Play size={14} />}
            >
              {actionLoading === "start" ? "Starting..." : "Start"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={actionLoading !== null || stack?.status !== "running"}
              onClick={() => handleAction("stop")}
              leftIcon={<Square size={14} />}
            >
              {actionLoading === "stop" ? "Stopping..." : "Stop"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={actionLoading !== null}
              onClick={() => handleAction("restart")}
              leftIcon={<RotateCw size={14} />}
            >
              {actionLoading === "restart" ? "Restarting..." : "Restart"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={actionLoading !== null}
              onClick={() => handleAction("delete")}
              leftIcon={<Trash2 size={14} />}
            >
              {actionLoading === "delete" ? "Deleting..." : "Delete"}
            </Button>
          </div>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
        {/* Left: Editor */}
        <div className="flex flex-col max-h-[calc(100vh-12rem)] overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent className="flex-1 flex flex-col min-h-0">
              <Tabs value={activeTab} onValueChange={setActiveTab} variant="underline" className="flex-1 flex flex-col min-h-0">
                <TabsList>
                  <TabTrigger value="compose">docker-compose.yml</TabTrigger>
                  <TabTrigger value="env">.env</TabTrigger>
                  <TabTrigger value="dockerfiles">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={14} />
                      Files
                      {Object.keys(dockerfiles).length > 0 && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          {Object.keys(dockerfiles).length}
                        </span>
                      )}
                    </span>
                  </TabTrigger>
                </TabsList>
                <TabContent value="compose" className="flex-1 min-h-0 overflow-auto p-0.5">
                  <div className="mt-4">
                    <ComposeEditor value={yaml} onChange={setYaml} rows={18} />
                  </div>
                </TabContent>
                <TabContent value="env" className="flex-1 min-h-0 overflow-auto p-0.5">
                  <div className="mt-4">
                    <Textarea
                      label="Environment Variables"
                      value={env}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEnv(e.target.value)}
                      placeholder={"# .env format\nNODE_ENV=production"}
                      rows={18}
                    />
                  </div>
                </TabContent>
                <TabContent value="dockerfiles" className="flex-1 min-h-0 overflow-auto p-0.5">
                  <div className="mt-4 space-y-4 min-h-[460px]">
                    {/* Add new file — any text file alongside the compose
                        file (Dockerfile, init.sql, nginx.conf, etc.). */}
                    <div className="flex items-end gap-2">
                      <Input
                        label="Filename"
                        placeholder="Dockerfile, nginx.conf, init.sql"
                        value={newDockerfileName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDockerfileName(e.target.value)}
                        className="flex-1 h-8"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!newDockerfileName.trim() || newDockerfileName.trim() in dockerfiles}
                        onClick={() => {
                          const fname = newDockerfileName.trim();
                          if (fname && !(fname in dockerfiles)) {
                            // Seed a Dockerfile skeleton only when the name
                            // signals one. Other files start empty so users
                            // can paste arbitrary content.
                            const seed = /^Dockerfile(\..+)?$/.test(fname)
                              ? "FROM node:20-alpine\n\nWORKDIR /app\n\nCOPY . .\n\nRUN npm install\n\nCMD [\"npm\", \"start\"]\n"
                              : "";
                            setDockerfiles(prev => ({ ...prev, [fname]: seed }));
                            setNewDockerfileName("");
                          }
                        }}
                        leftIcon={<Plus size={14} />}
                      >
                        Add
                      </Button>
                    </div>
                    {/* Dockerfile editors */}
                    {Object.entries(dockerfiles).map(([filename, content]) => (
                      <div key={filename} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium flex items-center gap-1.5">
                            <FileText size={14} className="text-muted-foreground" />
                            {filename}
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            onClick={() => {
                              setDockerfiles(prev => {
                                const next = { ...prev };
                                delete next[filename];
                                return next;
                              });
                            }}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        <ComposeEditor
                          value={content}
                          onChange={(val) => setDockerfiles(prev => ({ ...prev, [filename]: val }))}
                          rows={14}
                        />
                      </div>
                    ))}
                    {Object.keys(dockerfiles).length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No files. Add a Dockerfile, config, or any other file the compose stack mounts.
                      </p>
                    )}
                  </div>
                </TabContent>
              </Tabs>

              {isManager && (
                <div className="flex justify-end mt-4">
                  <Button disabled={saveLoading} onClick={handleDeploy}>
                    {saveLoading ? "Deploying..." : "Deploy Changes"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Logs + Containers */}
        <div className="flex flex-col max-h-[calc(100vh-12rem)] overflow-hidden">
          <Card className="flex-1 flex flex-col min-h-0">
            <CardContent className="flex-1 flex flex-col min-h-0">
              <Tabs value={rightTab} onValueChange={setRightTab} variant="underline" className="flex-1 flex flex-col min-h-0">
                <TabsList>
                  <TabTrigger value="logs">
                    <span className="inline-flex items-center gap-1.5">
                      <ScrollText size={14} />
                      Logs
                    </span>
                  </TabTrigger>
                  <TabTrigger value="containers">
                    <span className="inline-flex items-center gap-1.5">
                      <Box size={14} />
                      Containers
                      {stack && stack.containers.length > 0 && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          {stack.containers.length}
                        </span>
                      )}
                    </span>
                  </TabTrigger>
                </TabsList>
                <TabContent value="logs" className="flex-1 flex flex-col min-h-0 mt-4">
                  {stack && (
                    <LogViewer
                      stackName={name}
                      containers={stack.containers}
                    />
                  )}
                </TabContent>
                <TabContent value="containers" className="flex-1 min-h-0 overflow-auto mt-4">
                  {!stack || stack.containers.length === 0 ? (
                    <EmptyState
                      icon={<Box size={24} className="text-muted-foreground" />}
                      title="No containers"
                      description="No containers are running for this stack."
                    />
                  ) : (
                    <div className="space-y-3">
                      {stack.containers.map((c: ContainerInfo) => (
                        <div key={c.name} className="border border-border rounded-lg p-4 space-y-3">
                          {/* Container header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-sm font-medium truncate">{c.name}</span>
                              <CopyButton value={c.name} label="container name" />
                              <Badge variant={
                                c.state === "running" ? "success" : c.state === "exited" ? "destructive" : "warning"
                              }>
                                {c.state}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground font-mono truncate max-w-[120px] sm:max-w-[200px]">{c.image}</span>
                          </div>

                          {/* Details */}
                          <div className="grid grid-cols-1 gap-2 text-xs">
                            {c.ports.length > 0 && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground w-16 shrink-0">Ports</span>
                                <div className="font-mono text-foreground">
                                  {c.ports.map((p: any, i: number) => (
                                    <span key={i}>
                                      {i > 0 && <span className="text-muted-foreground">, </span>}
                                      {p.hostPort}:{p.containerPort}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {c.mounts && c.mounts.length > 0 && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground w-16 shrink-0">Volumes</span>
                                <div className="font-mono text-foreground space-y-0.5">
                                  {c.mounts.map((m: MountInfo, i: number) => (
                                    <div key={i}>
                                      {m.source} → {m.destination}{!m.rw ? " (ro)" : ""}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {c.networks && c.networks.length > 0 && (
                              <div className="flex gap-2">
                                <span className="text-muted-foreground w-16 shrink-0">Networks</span>
                                <div className="font-mono text-foreground space-y-0.5">
                                  {c.networks.map((n: NetworkInfo, i: number) => (
                                    <div key={i}>
                                      {n.name}{n.ipAddress ? ` (${n.ipAddress})` : ""}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}
