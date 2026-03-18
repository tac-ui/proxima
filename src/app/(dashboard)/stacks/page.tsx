"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useStacks } from "@/hooks/useStacks";
import { api } from "@/lib/api";
import { StackCard } from "@/components/stacks/StackCard";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";
import {
  Button,
  Input,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  EmptyState,
  Skeleton,
  Alert,
  AlertDescription,
  Textarea,
  Tabs,
  TabsList,
  TabTrigger,
  TabContent,
  pageEntrance,
  tacSpring,
} from "@tac-ui/web";
import { ComposeEditor } from "@/components/stacks/ComposeEditor";
import { Plus, Layers, Search, FileText, Trash2, AlertTriangle, RefreshCw } from "@tac-ui/icon";
import { useAuth } from "@/contexts/AuthContext";

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

const cardItem = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: tacSpring.entrance },
};

const DEFAULT_COMPOSE = `version: '3.8'
services:
  app:
    image: nginx:latest
    ports:
      - '80:80'
    restart: unless-stopped
`;

export default function StacksPage() {
  const { isManager } = useAuth();
  const { stackList, loading, deploy, start, stop } = useStacks();
  const [dockerConnected, setDockerConnected] = useState<boolean | null>(null);
  const [dockerChecking, setDockerChecking] = useState(true);
  const [search, setSearch] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newYaml, setNewYaml] = useState(DEFAULT_COMPOSE);
  const [newEnv, setNewEnv] = useState("");
  const [newDockerfiles, setNewDockerfiles] = useState<Record<string, string>>({});
  const [newDockerfileName, setNewDockerfileName] = useState("Dockerfile");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");

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

  const filtered = stackList
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (a.name === "proxima" ? -1 : b.name === "proxima" ? 1 : 0));

  const handleDeploy = async () => {
    if (!newName.trim()) {
      setDeployError("Stack name is required");
      return;
    }
    setDeploying(true);
    setDeployError("");
    try {
      const dockerfilesToSend = Object.keys(newDockerfiles).length > 0 ? newDockerfiles : undefined;
      await deploy(newName.trim(), newYaml, newEnv, true, dockerfilesToSend);
      setShowNew(false);
      setNewName("");
      setNewYaml(DEFAULT_COMPOSE);
      setNewEnv("");
      setNewDockerfiles({});
      setNewDockerfileName("Dockerfile");
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const dockerReady = dockerConnected === true;

  return (
    <motion.div className="space-y-6" {...pageEntrance}>
      {/* Top bar */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-96">
          <Input
            inputSize="sm"
            placeholder="Search stacks..."
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            leftIcon={<Search size={16} />}
            disabled={!dockerReady}
          />
        </div>
        {isManager && (
          <Button size="sm" onClick={() => setShowNew(true)} leftIcon={<Plus size={14} />} disabled={!dockerReady}>
            New Stack
          </Button>
        )}
      </div>

      <LoadingIndicator visible={dockerConnected === null || loading} />

      <AnimatePresence mode="wait">
        {dockerConnected === null ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
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
        ) : loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-xl" />
            ))}
          </motion.div>
        ) : filtered.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <EmptyState
              icon={<Layers size={32} className="text-point" />}
              title={search ? "No stacks found" : "No stacks deployed"}
              description={
                search
                  ? `No stacks match "${search}"`
                  : "Deploy your first Docker Compose stack to get started."
              }
              action={
                !search && isManager ? (
                  <Button onClick={() => setShowNew(true)} leftIcon={<Plus size={14} />}>
                    Deploy First Stack
                  </Button>
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
            <motion.div
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
            >
              {filtered.map((stack) => (
                <motion.div key={stack.name} variants={cardItem}>
                  <StackCard
                    stack={stack}
                    onStart={start}
                    onStop={stop}
                    isManager={isManager}
                  />
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Stack Modal */}
      {typeof document !== "undefined" && createPortal(
        <Modal
          open={showNew}
          onClose={() => setShowNew(false)}
          size="lg"
        >
          <ModalHeader>
            <ModalTitle>New Stack</ModalTitle>
          </ModalHeader>
          <div className="px-6 pb-6 space-y-4 overflow-y-auto max-h-[60vh]">
            <Input
              label="Stack Name"
              placeholder="my-app"
              value={newName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value.replace(/[^a-z0-9-_]/gi, ""))}
              error={!!(deployError && !newName)}
              errorMessage={deployError && !newName ? "Stack name is required" : undefined}
            />
            <Tabs defaultValue="compose" variant="underline">
              <TabsList>
                <TabTrigger value="compose">docker-compose.yml</TabTrigger>
                <TabTrigger value="env">.env</TabTrigger>
                <TabTrigger value="dockerfiles">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText size={14} />
                    Dockerfiles
                    {Object.keys(newDockerfiles).length > 0 && (
                      <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                        {Object.keys(newDockerfiles).length}
                      </span>
                    )}
                  </span>
                </TabTrigger>
              </TabsList>
              <TabContent value="compose">
                <div className="mt-4">
                  <ComposeEditor
                    value={newYaml}
                    onChange={setNewYaml}
                    rows={14}
                  />
                </div>
              </TabContent>
              <TabContent value="env">
                <div className="mt-4">
                  <Textarea
                    label="Environment Variables"
                    value={newEnv}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewEnv(e.target.value)}
                    placeholder={"# .env format\nNODE_ENV=production\nPORT=3000"}
                    rows={14}
                  />
                </div>
              </TabContent>
              <TabContent value="dockerfiles">
                <div className="mt-4 space-y-4 min-h-[360px]">
                  {/* Add new Dockerfile */}
                  <div className="flex items-end gap-2">
                    <Input
                      label="Filename"
                      placeholder="Dockerfile"
                      value={newDockerfileName}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewDockerfileName(e.target.value)}
                      className="flex-1 h-8"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!newDockerfileName.trim() || newDockerfileName.trim() in newDockerfiles}
                      onClick={() => {
                        const name = newDockerfileName.trim();
                        if (name && !(name in newDockerfiles)) {
                          setNewDockerfiles(prev => ({ ...prev, [name]: "FROM node:20-alpine\n\nWORKDIR /app\n\nCOPY . .\n\nRUN npm install\n\nCMD [\"npm\", \"start\"]\n" }));
                          setNewDockerfileName("Dockerfile");
                        }
                      }}
                      leftIcon={<Plus size={14} />}
                    >
                      Add
                    </Button>
                  </div>
                  {/* Dockerfile editors */}
                  {Object.entries(newDockerfiles).map(([filename, content]) => (
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
                            setNewDockerfiles(prev => {
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
                        onChange={(val) => setNewDockerfiles(prev => ({ ...prev, [filename]: val }))}
                        rows={10}
                      />
                    </div>
                  ))}
                  {Object.keys(newDockerfiles).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No Dockerfiles added. Add one above if your services need custom images.
                    </p>
                  )}
                </div>
              </TabContent>
            </Tabs>
            {deployError && (
              <Alert variant="error">
                <AlertDescription>{deployError}</AlertDescription>
              </Alert>
            )}
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button disabled={deploying} onClick={handleDeploy}>
              {deploying ? "Deploying..." : "Deploy Stack"}
            </Button>
          </ModalFooter>
        </Modal>,
        document.body
      )}
    </motion.div>
  );
}
