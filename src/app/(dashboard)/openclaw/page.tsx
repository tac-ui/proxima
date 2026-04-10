"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import { api } from "@/lib/api";
import { Card, CardHeader, CardContent, Button, Badge, SensitiveInput, Select, pageEntrance, useToast } from "@tac-ui/web";
import { BrainCircuit, Settings, MessageSquare, Wifi, Key } from "@tac-ui/icon";
import { useConfirm } from "@/hooks/useConfirm";
import { SessionList } from "@/components/openclaw/SessionList";
import { ChannelSetup } from "@/components/openclaw/ChannelSetup";
import { ModelManager } from "@/components/openclaw/ModelManager";
import { ModelSelector } from "@/components/openclaw/ModelSelector";
import { ConfigEditor } from "@/components/openclaw/ConfigEditor";

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const { toast } = useToast();
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);

  const PROVIDERS = [
    { value: "anthropic", label: "Anthropic (Claude)" },
    { value: "openai", label: "OpenAI (GPT)" },
    { value: "google", label: "Google (Gemini)" },
    { value: "openrouter", label: "OpenRouter" },
  ];

  const KEY_MAP: Record<string, { field: string; placeholder: string }> = {
    anthropic: { field: "anthropicApiKey", placeholder: "sk-ant-..." },
    openai: { field: "openaiApiKey", placeholder: "sk-..." },
    google: { field: "geminiApiKey", placeholder: "AI..." },
    openrouter: { field: "openrouterApiKey", placeholder: "sk-or-..." },
  };

  const handleStart = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      const mapping = KEY_MAP[provider];
      const res = await api.updateOpenClawSettings({
        enabled: true,
        gatewayPort: 18789,
        models: { [mapping.field]: apiKey.trim() } as Record<string, string>,
      });
      if (res.ok) {
        toast("OpenClaw is starting...", { variant: "success" });
        setTimeout(onComplete, 3000);
      } else {
        toast(res.error ?? "Failed to start", { variant: "error" });
        setLoading(false);
      }
    } catch {
      toast("Failed to configure OpenClaw", { variant: "error" });
      setLoading(false);
    }
  };

  return (
    <motion.div className="max-w-screen-md mx-auto space-y-6" {...pageEntrance}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <BrainCircuit size={18} className="text-point" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Get Started with OpenClaw</h2>
              <p className="text-xs text-muted-foreground">Choose a provider and paste your API key to start</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1.5">Provider</label>
              <Select options={PROVIDERS} value={provider} onChange={setProvider} />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">API Key</label>
              <SensitiveInput
                value={apiKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                placeholder={KEY_MAP[provider].placeholder}
              />
            </div>
            <Button variant="primary" size="sm" disabled={!apiKey.trim() || loading} onClick={handleStart}>
              {loading ? "Starting..." : "Start OpenClaw"}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              You can add more providers and configure channels later.
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export default function OpenClawPage() {
  const { isManager } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { gateway, enabled, settings, sessions, channels, refreshSessions, refreshChannels, refreshSettings } = useOpenClaw();
  const [creatingSession, setCreatingSession] = useState(false);

  if (!enabled) {
    return <Onboarding onComplete={() => { refreshSettings(); }} />;
  }

  const handleCreateSession = async () => {
    if (!gateway.connected) return;
    setCreatingSession(true);
    try {
      await gateway.request("sessions.create", {});
      await refreshSessions();
      toast("Session created", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create session", { variant: "error" });
    }
    setCreatingSession(false);
  };

  const handleDeleteSession = async (key: string) => {
    if (!gateway.connected) return;
    const session = sessions.find(s => s.key === key);
    const ok = await confirm({
      title: "Delete Session",
      message: `Delete "${session?.label || key}"? All messages will be permanently removed.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await gateway.request("sessions.delete", { key });
      await refreshSessions();
      toast("Session deleted", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete session", { variant: "error" });
    }
  };

  return (
    <motion.div className="max-w-screen-md mx-auto space-y-6" {...pageEntrance}>
      {/* Sessions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
              <BrainCircuit size={18} className="text-point" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">OpenClaw</h2>
                <Badge variant={gateway.connected ? "success" : "secondary"}>
                  {gateway.connected ? "Connected" : "Disconnected"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">AI Assistant</p>
            </div>
            {isManager && (
              <Link href="/settings">
                <Button variant="ghost" size="sm" leftIcon={<Settings size={14} />}>
                  Settings
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <SessionList
            sessions={sessions}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            creating={creatingSession}
            connected={gateway.connected}
          />
        </CardContent>
      </Card>

      {/* Channels */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
              <Wifi size={18} className="text-success" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Channels</h2>
              <p className="text-xs text-muted-foreground">Connect messaging platforms</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ChannelSetup gateway={gateway} channels={channels} onRefresh={refreshChannels} />
        </CardContent>
      </Card>

      {/* Model */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center">
              <BrainCircuit size={18} className="text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Model</h2>
              <p className="text-xs text-muted-foreground">Default AI model for conversations</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ModelSelector gateway={gateway} />
        </CardContent>
      </Card>

      {/* API Keys */}
      {isManager && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <Key size={18} className="text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">API Keys</h2>
                <p className="text-xs text-muted-foreground">Manage model provider credentials</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ModelManager settings={settings} onSaved={refreshSettings} />
          </CardContent>
        </Card>
      )}

      {/* Advanced Config */}
      {isManager && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <Settings size={18} className="text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Advanced Config</h2>
                <p className="text-xs text-muted-foreground">Full OpenClaw configuration</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ConfigEditor gateway={gateway} />
          </CardContent>
        </Card>
      )}
    </motion.div>
  );
}
