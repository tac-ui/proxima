"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useApiContext } from "@/contexts/ApiContext";
import { api } from "@/lib/api";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Textarea,
  Skeleton,
  EmptyState,
  useToast,
} from "@tac-ui/web";
import { ComposeEditor } from "@/components/stacks/ComposeEditor";
import { ChevronLeft, Play, Square, RotateCw, Trash2, Box, FileText, Plus } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/contexts/AuthContext";
import { CopyButton } from "@/components/shared/CopyButton";
import dynamic from "next/dynamic";
import type { Stack, ContainerInfo, MountInfo } from "@/types";

const TerminalPanel = dynamic(
  () => import("@/components/terminal/TerminalPanel").then((m) => m.TerminalPanel),
  { ssr: false, loading: () => <div className="h-64 bg-background rounded-lg animate-pulse" /> }
);

const statusVariantMap: Record<string, "success" | "destructive" | "warning" | "secondary"> = {
  running: "success",
  exited: "destructive",
  created: "warning",
  partial: "warning",
  unknown: "secondary",
};

const statusLabelMap: Record<string, string> = {
  running: "Running",
  exited: "Exited",
  created: "Created",
  partial: "Partial",
  unknown: "Unknown",
};

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
  const [newDockerfileName, setNewDockerfileName] = useState("Dockerfile");
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

  const terminalId = `stack-${name}`;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton height={48} />
        <div className="grid grid-cols-2 gap-6">
          <Skeleton height={384} />
          <Skeleton height={384} />
        </div>
      </div>
    );
  }

  if (!stack && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">Stack not found or failed to load.</p>
        <Button variant="secondary" onClick={() => router.push("/stacks")}>Back to Stacks</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold truncate">{name}</h1>
              {stack && (
                <Badge variant={statusVariantMap[stack.status] ?? "secondary"}>
                  {statusLabelMap[stack.status] ?? stack.status}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {isManager && (
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Editor */}
        <div className="space-y-4">
          <Card>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} variant="underline">
                <TabsList>
                  <TabTrigger value="compose">docker-compose.yml</TabTrigger>
                  <TabTrigger value="env">.env</TabTrigger>
                  <TabTrigger value="dockerfiles">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText size={14} />
                      Dockerfiles
                      {Object.keys(dockerfiles).length > 0 && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          {Object.keys(dockerfiles).length}
                        </span>
                      )}
                    </span>
                  </TabTrigger>
                </TabsList>
                <TabContent value="compose">
                  <div className="mt-4">
                    <ComposeEditor value={yaml} onChange={setYaml} rows={18} />
                  </div>
                </TabContent>
                <TabContent value="env">
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
                <TabContent value="dockerfiles">
                  <div className="mt-4 space-y-4 min-h-[460px]">
                    {/* Add new Dockerfile */}
                    <div className="flex items-end gap-2">
                      <Input
                        label="Filename"
                        placeholder="Dockerfile"
                        value={newDockerfileName}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDockerfileName(e.target.value)}
                        className="flex-1"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!newDockerfileName.trim() || newDockerfileName.trim() in dockerfiles}
                        onClick={() => {
                          const fname = newDockerfileName.trim();
                          if (fname && !(fname in dockerfiles)) {
                            setDockerfiles(prev => ({ ...prev, [fname]: "FROM node:20-alpine\n\nWORKDIR /app\n\nCOPY . .\n\nRUN npm install\n\nCMD [\"npm\", \"start\"]\n" }));
                            setNewDockerfileName("Dockerfile");
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
                        No Dockerfiles. Add one above if your services need custom images.
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

        {/* Right: Terminal + Containers */}
        <div className="space-y-4">
          <TerminalPanel
            terminalId={terminalId}
            title="Logs"
            mode="interactive"
            showToolbar={true}
            rows={14}
          />

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold">
                Containers
                {stack && stack.containers.length > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">({stack.containers.length})</span>
                )}
              </h3>
            </CardHeader>
            <CardContent>
              {!stack || stack.containers.length === 0 ? (
                <EmptyState
                  icon={<Box size={24} className="text-muted-foreground" />}
                  title="No containers"
                  description="No containers are running for this stack."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Image</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Ports</TableHead>
                      <TableHead>Volumes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stack.containers.map((c: ContainerInfo) => (
                      <TableRow key={c.name}>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 font-mono">
                            {c.name}
                            <CopyButton value={c.name} label="container name" />
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-muted-foreground font-mono truncate max-w-[200px]">
                            {c.image}
                            <CopyButton value={c.image} label="image" />
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={
                            c.state === "running" ? "success" : c.state === "exited" ? "destructive" : "warning"
                          }>
                            {c.state}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.ports.length > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              {c.ports.map((p: any) => `${p.hostPort}:${p.containerPort}`).join(", ")}
                              <CopyButton value={c.ports.map((p: any) => `${p.hostPort}:${p.containerPort}`).join(", ")} label="ports" />
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          {c.mounts && c.mounts.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {c.mounts.map((m: MountInfo, i: number) => (
                                <span key={i} className="inline-flex items-center gap-1 text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                  {m.source}:{m.destination}{!m.rw ? " (ro)" : ""}
                                </span>
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
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
