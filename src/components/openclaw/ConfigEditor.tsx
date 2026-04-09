"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Input, Textarea, Select, Switch, Button, Tabs, TabsList, TabTrigger, TabContent, Badge, useToast } from "@tac-ui/web";
import { Settings, Bot, MessageCircle, Shield, Code, Save, KeyRound } from "@tac-ui/icon";
import { api } from "@/lib/api";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";
import type { OpenClawSettings, SshKeyInfo } from "@/types";

interface ConfigEditorProps {
  gateway: OpenClawGateway;
  settings?: OpenClawSettings | null;
  onSettingsSaved?: () => void;
}

interface ConfigState {
  config: Record<string, unknown>;
  hash: string;
}

// Helper to deep-get a value from nested object
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function ConfigEditor({ gateway, settings, onSettingsSaved }: ConfigEditorProps) {
  const { toast } = useToast();
  const [state, setState] = useState<ConfigState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [rawJsonError, setRawJsonError] = useState("");

  // SSH key state
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [selectedSshKeyId, setSelectedSshKeyId] = useState<string>("");

  // Local form state
  const [systemPrompt, setSystemPrompt] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("off");
  const [dmPolicy, setDmPolicy] = useState("pairing");
  const [groupPolicy, setGroupPolicy] = useState("open");
  const [allowFrom, setAllowFrom] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!gateway.connected) return;
    setLoading(true);
    try {
      const result = await gateway.request<ConfigState>("config.get");
      setState(result);

      const c = result.config;

      // Agent settings
      const agents = c.agents as Record<string, unknown> | undefined;
      const defaults = agents?.defaults as Record<string, unknown> | undefined;
      setSystemPrompt((defaults?.systemPrompt as string) ?? "");
      setThinkingLevel((defaults?.thinkingLevel as string) ?? "off");

      // Channel defaults
      const channels = c.channels as Record<string, unknown> | undefined;
      const chDefaults = channels?.defaults as Record<string, unknown> | undefined;
      setDmPolicy((chDefaults?.dmPolicy as string) ?? (deepGet(c, "channels.telegram.dmPolicy") as string) ?? "pairing");
      setGroupPolicy((chDefaults?.groupPolicy as string) ?? "open");

      // AllowFrom (from telegram or discord, whichever exists)
      const tgAllow = deepGet(c, "channels.telegram.allowFrom") as number[] | undefined;
      const dcAllow = deepGet(c, "channels.discord.allowFrom") as string[] | undefined;
      setAllowFrom((tgAllow ?? dcAllow ?? []).join(", "));

      // Memory
      const memory = c.memory as Record<string, unknown> | undefined;
      setMemoryEnabled((memory?.enabled as boolean) ?? false);

      // Streaming
      const session = c.session as Record<string, unknown> | undefined;
      setStreamingEnabled((session?.streaming as boolean) ?? true);

      // Raw JSON
      setRawJson(JSON.stringify(result.config, null, 2));
      setRawJsonError("");

      // SSH keys
      const keysRes = await api.getSshKeys();
      if (keysRes.ok && keysRes.data) {
        setSshKeys(keysRes.data);
        // Auto-select if only one key exists and none is set
        const currentKeyId = settings?.sshKeyId;
        if (currentKeyId) {
          setSelectedSshKeyId(String(currentKeyId));
        } else if (keysRes.data.length === 1) {
          setSelectedSshKeyId(String(keysRes.data[0].id));
        }
      }
    } catch {
      toast("Failed to load config", { variant: "error" });
    }
    setLoading(false);
  }, [gateway, toast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const patchConfig = async (patch: Record<string, unknown>) => {
    if (!state) return false;
    setSaving(true);
    try {
      // Get fresh hash
      const fresh = await gateway.request<ConfigState>("config.get");
      await gateway.request("config.patch", {
        raw: JSON.stringify(patch),
        baseHash: fresh.hash,
      });
      toast("Settings saved", { variant: "success" });
      await loadConfig();
      setSaving(false);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
      setSaving(false);
      return false;
    }
  };

  const handleSaveAgent = async () => {
    const ok = await patchConfig({
      agents: {
        defaults: {
          systemPrompt: systemPrompt || undefined,
          thinkingLevel: thinkingLevel !== "off" ? thinkingLevel : undefined,
        },
      },
    });
    // Also save SSH key to Proxima settings
    if (ok) {
      const keyId = selectedSshKeyId ? parseInt(selectedSshKeyId, 10) : null;
      await api.updateOpenClawSettings({ sshKeyId: keyId });
      onSettingsSaved?.();
    }
  };

  const handleSaveChannelDefaults = () => {
    const ids = allowFrom.split(",").map(s => s.trim()).filter(Boolean);
    return patchConfig({
      channels: {
        defaults: {
          dmPolicy,
          groupPolicy,
        },
        ...(ids.length > 0 ? {
          telegram: { allowFrom: ids.map(Number).filter(n => !isNaN(n)) },
          discord: { allowFrom: ids },
        } : {}),
      },
    });
  };

  const handleSaveAdvanced = async () => {
    try {
      JSON.parse(rawJson);
      setRawJsonError("");
    } catch (err) {
      setRawJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      const fresh = await gateway.request<ConfigState>("config.get");
      await gateway.request("config.set", {
        raw: rawJson,
        baseHash: fresh.hash,
      });
      toast("Config saved", { variant: "success" });
      await loadConfig();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  if (loading || !state) {
    return <p className="text-sm text-muted-foreground text-center py-8">Loading configuration...</p>;
  }

  return (
    <Tabs defaultValue="agent">
      <TabsList>
        <TabTrigger value="agent">Agent</TabTrigger>
        <TabTrigger value="channels">Channels</TabTrigger>
        <TabTrigger value="advanced">Advanced</TabTrigger>
      </TabsList>

      {/* Agent Settings */}
      <TabContent value="agent">
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">System Prompt</label>
            <Textarea
              value={systemPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={4}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Instructions that guide the AI's behavior across all conversations.</p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Thinking Level</label>
            <Select
              options={[
                { value: "off", label: "Off" },
                { value: "minimal", label: "Minimal" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
              value={thinkingLevel}
              onChange={setThinkingLevel}
            />
            <p className="text-[10px] text-muted-foreground mt-1">How much internal reasoning the AI performs before responding.</p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Streaming</p>
              <p className="text-[10px] text-muted-foreground">Show responses as they're generated</p>
            </div>
            <Switch checked={streamingEnabled} onChange={setStreamingEnabled} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Memory</p>
              <p className="text-[10px] text-muted-foreground">Remember context across conversations</p>
            </div>
            <Switch checked={memoryEnabled} onChange={setMemoryEnabled} />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">SSH Key for Git</label>
            <Select
              options={[
                { value: "", label: "None (use default)" },
                ...sshKeys.map(k => ({ value: String(k.id), label: `${k.alias} (${k.keyPath})` })),
              ]}
              value={selectedSshKeyId}
              onChange={setSelectedSshKeyId}
            />
            <p className="text-[10px] text-muted-foreground mt-1">SSH key used when the AI agent performs git operations.</p>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={saving} onClick={handleSaveAgent} leftIcon={<Save size={14} />}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </TabContent>

      {/* Channel Defaults */}
      <TabContent value="channels">
        <div className="space-y-4 pt-4">
          <div>
            <label className="text-sm font-medium block mb-1.5">DM Policy</label>
            <Select
              options={[
                { value: "pairing", label: "Pairing (Approve first)" },
                { value: "open", label: "Open (Anyone can DM)" },
                { value: "allowlist", label: "Allowlist Only" },
                { value: "disabled", label: "Disabled" },
              ]}
              value={dmPolicy}
              onChange={setDmPolicy}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Who can send direct messages to the bot.</p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Group Policy</label>
            <Select
              options={[
                { value: "open", label: "Open (All groups)" },
                { value: "allowlist", label: "Allowlist Only" },
                { value: "disabled", label: "Disabled" },
              ]}
              value={groupPolicy}
              onChange={setGroupPolicy}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Who can interact in group chats.</p>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1.5">Allowed Users</label>
            <Input
              value={allowFrom}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllowFrom(e.target.value)}
              placeholder="123456789, 987654321"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Comma-separated user IDs allowed to interact with the bot.</p>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={saving} onClick={handleSaveChannelDefaults} leftIcon={<Save size={14} />}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </TabContent>

      {/* Advanced JSON Editor */}
      <TabContent value="advanced">
        <div className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Full Configuration</p>
              <p className="text-[10px] text-muted-foreground">Edit the raw openclaw.json configuration. Be careful with changes.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={loadConfig}>Reload</Button>
          </div>

          <div className="relative">
            <textarea
              value={rawJson}
              onChange={(e) => {
                setRawJson(e.target.value);
                try { JSON.parse(e.target.value); setRawJsonError(""); } catch (err) { setRawJsonError(err instanceof Error ? err.message : "Invalid JSON"); }
              }}
              rows={20}
              spellCheck={false}
              className="w-full px-4 py-3 text-xs font-mono rounded-lg border border-border bg-muted text-foreground outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed"
            />
            {rawJsonError && (
              <p className="text-xs text-error mt-1">{rawJsonError}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={saving || !!rawJsonError} onClick={handleSaveAdvanced} leftIcon={<Save size={14} />}>
              {saving ? "Saving..." : "Save Config"}
            </Button>
          </div>
        </div>
      </TabContent>
    </Tabs>
  );
}
