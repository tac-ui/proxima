"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, SensitiveInput, Input, Badge, Switch, Skeleton, useToast } from "@tac-ui/web";
import { Download, ChevronDown, Send } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import { useConfirm } from "@/hooks/useConfirm";
import type { OpenClawChannel } from "@/types";

interface ProximaChannel {
  type: string;
  name: string;
  config: Record<string, string>;
}

interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  sensitive: boolean;
  required: boolean;
  helpText?: string;
}

interface ChannelDef {
  type: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  fields: ChannelField[];
  guide: string[];
}

function SvgIcon({ d, size = 16 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d={d} /></svg>;
}

const TG_ICON = "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z";
const DC_ICON = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z";

const CHANNELS: ChannelDef[] = [
  {
    type: "telegram",
    label: "Telegram",
    icon: <SvgIcon d={TG_ICON} />,
    color: "bg-[#26A5E4]/15 text-[#26A5E4]",
    borderColor: "border-[#26A5E4]/30",
    fields: [
      {
        key: "botToken",
        label: "Bot Token",
        placeholder: "123456789:ABCdefGHI...",
        sensitive: true,
        required: true,
        helpText: "Create a bot with @BotFather on Telegram and paste the token here.",
      },
      {
        key: "allowFrom",
        label: "Allowed User IDs",
        placeholder: "123456789, 987654321",
        sensitive: false,
        required: false,
        helpText: "Comma-separated Telegram numeric IDs. Find yours via @userinfobot. Leave empty to allow anyone.",
      },
    ],
    guide: [
      "Open Telegram → search @BotFather",
      "Send /newbot, pick a name",
      "Copy the HTTP API token",
    ],
  },
  {
    type: "discord",
    label: "Discord",
    icon: <SvgIcon d={DC_ICON} />,
    color: "bg-[#5865F2]/15 text-[#5865F2]",
    borderColor: "border-[#5865F2]/30",
    fields: [
      {
        key: "token",
        label: "Bot Token",
        placeholder: "MTk4NjIz...",
        sensitive: true,
        required: true,
        helpText: "From Discord Developer Portal → Bot → Reset Token.",
      },
    ],
    guide: [
      "discord.com/developers/applications → New Application",
      "Bot section → Reset Token, copy it",
      "Enable 'Message Content Intent' under Privileged Gateway Intents",
      "OAuth2 → URL Generator → scope: bot → paste URL in browser to invite",
    ],
  },
];

interface FormState { fields: Record<string, string>; enabled: boolean; }
interface TestState { to: string; message: string; sending: boolean; }

const DEFAULT_TEST_STATE: TestState = { to: "", message: "Test from Proxima", sending: false };

function statusBadge(ch: OpenClawChannel | undefined) {
  if (!ch) return { label: "Not configured", variant: "secondary" as const };
  if (ch.status === "error") return { label: "Error", variant: "error" as const };
  if (!ch.configured) return { label: "Not configured", variant: "secondary" as const };
  if (ch.enabled === false) return { label: "Disabled", variant: "secondary" as const };
  if (ch.status === "connected") return { label: "Connected", variant: "success" as const };
  return { label: "Disconnected", variant: "warning" as const };
}

/** Pull the compatible token out of a Proxima notification-channel config. */
function extractImportableToken(channelType: string, config: Record<string, string>): { key: string; value: string } | null {
  if (channelType === "telegram" && config.botToken) {
    return { key: "botToken", value: config.botToken };
  }
  // Proxima Discord notification channels store webhookUrl, which isn't
  // compatible with OpenClaw's bot-token flow — nothing to import.
  return null;
}

export function ChannelSetup() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const {
    gateway,
    channels,
    channelsLoading,
    configHash,
    pendingModel,
    refreshChannels,
    commitPendingPatch,
  } = useOpenClaw();
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [proximaChannels, setProximaChannels] = useState<ProximaChannel[]>([]);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const updateTest = (channelType: string, patch: Partial<TestState>) => {
    setTests(prev => ({
      ...prev,
      [channelType]: { ...DEFAULT_TEST_STATE, ...prev[channelType], ...patch },
    }));
  };

  const handleTestSend = async (def: ChannelDef) => {
    const state = tests[def.type] ?? DEFAULT_TEST_STATE;
    const to = state.to.trim();
    const message = state.message.trim();
    if (!to) {
      toast("Enter a recipient ID", { variant: "error" });
      return;
    }
    if (!message) {
      toast("Enter a message", { variant: "error" });
      return;
    }
    updateTest(def.type, { sending: true });
    try {
      const idempotencyKey = `proxima-test-${def.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await gateway.request("send", {
        channel: def.type,
        to,
        message,
        idempotencyKey,
      });
      toast(`${def.label} test message sent`, { variant: "success" });
    } catch (err) {
      toast(
        err instanceof Error ? `Test failed: ${err.message}` : "Test failed",
        { variant: "error" },
      );
    }
    updateTest(def.type, { sending: false });
  };

  // Load Proxima's notification channels once so we can offer them as
  // one-click importers inside the matching OpenClaw channel card.
  useEffect(() => {
    api.getOpenClawImportChannels()
      .then(res => {
        if (res.ok && res.data) setProximaChannels(res.data);
      })
      .catch(() => { /* ignore */ });
  }, []);

  // Seed "enabled" toggle from the server state when channels refresh.
  useEffect(() => {
    setForms(prev => {
      const next: Record<string, FormState> = { ...prev };
      for (const def of CHANNELS) {
        const ch = channels.find(c => c.type === def.type);
        const existing = next[def.type];
        next[def.type] = {
          fields: existing?.fields ?? {},
          enabled: existing?.enabled ?? (ch?.enabled !== false && ch?.configured === true),
        };
      }
      return next;
    });
  }, [channels]);

  const updateField = (channelType: string, fieldKey: string, value: string) => {
    setForms(prev => ({
      ...prev,
      [channelType]: {
        fields: { ...(prev[channelType]?.fields ?? {}), [fieldKey]: value },
        enabled: prev[channelType]?.enabled ?? false,
      },
    }));
  };

  const setEnabled = (channelType: string, enabled: boolean) => {
    setForms(prev => ({
      ...prev,
      [channelType]: {
        fields: prev[channelType]?.fields ?? {},
        enabled,
      },
    }));
  };

  const patchConfig = async (patch: Record<string, unknown>): Promise<boolean> => {
    if (!configHash) {
      toast("Config not loaded yet — try again in a moment", { variant: "error" });
      return false;
    }
    // Delegate to the context's bundled commit so any staged model change
    // rides along in the same config.patch RPC — triggering one gateway
    // reload instead of two.
    const ok = await commitPendingPatch(patch);
    if (!ok) {
      toast("Failed to update config", { variant: "error" });
    }
    return ok;
  };

  const handleSave = async (def: ChannelDef) => {
    const form = forms[def.type] ?? { fields: {}, enabled: true };
    const ch = channels.find(c => c.type === def.type);
    const alreadyConfigured = ch?.configured === true;

    // Require inputs only if not yet configured; otherwise empty fields
    // keep the existing value server-side.
    for (const f of def.fields) {
      const val = form.fields[f.key]?.trim();
      if (f.required && !alreadyConfigured && !val) {
        toast(`${f.label} is required`, { variant: "error" });
        return;
      }
    }

    setSaving(def.type);
    const channelConfig: Record<string, unknown> = { enabled: form.enabled };
    for (const f of def.fields) {
      const val = form.fields[f.key]?.trim();
      if (!val) continue;
      if (f.key === "allowFrom") {
        const ids = val.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
        if (ids.length > 0) {
          channelConfig.allowFrom = ids;
          channelConfig.dmPolicy = "allowlist";
        }
      } else {
        channelConfig[f.key] = val;
      }
    }

    const ok = await patchConfig({ channels: { [def.type]: channelConfig } });
    if (ok) {
      toast(`${def.label} saved`, { variant: "success" });
      // Clear sensitive fields after save so they aren't lingering in memory
      setForms(prev => ({
        ...prev,
        [def.type]: { fields: {}, enabled: form.enabled },
      }));
      setTimeout(refreshChannels, 1500);
    }
    setSaving(null);
  };

  const handleRemove = async (def: ChannelDef) => {
    const confirmed = await confirm({
      title: `Clear ${def.label} config?`,
      message: `This removes the saved ${def.label} credentials and disables the channel. You can reconfigure it later.`,
      confirmLabel: "Clear",
      variant: "destructive",
    });
    if (!confirmed) return;
    setSaving(def.type);
    const clearConfig: Record<string, unknown> = { enabled: false };
    for (const f of def.fields) {
      clearConfig[f.key] = null;
    }
    const ok = await patchConfig({ channels: { [def.type]: clearConfig } });
    if (ok) {
      toast(`${def.label} cleared`, { variant: "success" });
      setForms(prev => ({ ...prev, [def.type]: { fields: {}, enabled: false } }));
      setTimeout(refreshChannels, 1500);
    }
    setSaving(null);
  };

  const applyProximaImport = (def: ChannelDef, source: ProximaChannel) => {
    const token = extractImportableToken(def.type, source.config);
    if (!token) {
      toast(`"${source.name}" doesn't have a compatible token for ${def.label}`, { variant: "warning" });
      return;
    }
    updateField(def.type, token.key, token.value);
    // Always enable when importing — the user intent is to use this channel.
    setEnabled(def.type, true);
    toast(`Loaded "${source.name}" — click Save to connect`, { variant: "success" });
  };

  // Initial skeleton: show placeholder cards while the first channels.status
  // RPC is in flight. Once channels arrives (even as empty array), we switch
  // to the real layout immediately.
  if (channelsLoading && channels.length === 0) {
    return (
      <div className="space-y-3">
        {CHANNELS.map((def) => (
          <div key={def.type} className={`border rounded-lg ${def.borderColor} p-3 flex items-center gap-3`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${def.color}`}>
              {def.icon}
            </div>
            <div className="flex-1 min-w-0">
              <Skeleton width={120} height={14} />
              <Skeleton width={80} height={10} className="mt-1" />
            </div>
            <Skeleton width={72} height={22} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {CHANNELS.map((def) => {
        const ch = channels.find(c => c.type === def.type);
        const badge = statusBadge(ch);
        const form = forms[def.type] ?? { fields: {}, enabled: false };
        const isOpen = open === def.type;
        const isSaving = saving === def.type;
        const alreadyConfigured = ch?.configured === true;

        return (
          <div key={def.type} className={`border rounded-lg overflow-hidden ${def.borderColor}`}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : def.type)}
              aria-expanded={isOpen}
              aria-label={`${def.label} — ${isOpen ? "collapse" : "expand"}`}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${def.color}`}>
                {def.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{def.label}</p>
                {ch?.lastError && (
                  <p className="text-[10px] text-error truncate" title={ch.lastError}>
                    {ch.lastError}
                  </p>
                )}
              </div>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="shrink-0 text-muted-foreground"
              >
                <ChevronDown size={14} />
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 pt-3 space-y-3 border-t border-border">
                    {(() => {
                      const importable = proximaChannels.filter(c =>
                        c.type === def.type && extractImportableToken(def.type, c.config) !== null
                      );
                      if (importable.length === 0) return null;
                      return (
                        <div className="bg-muted/30 rounded-md p-2.5 space-y-1.5">
                          <p className="text-[10px] font-medium text-foreground flex items-center gap-1">
                            <Download size={10} /> Import from Proxima
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {importable.map((c, i) => (
                              <button
                                key={`${c.type}-${c.name}-${i}`}
                                type="button"
                                onClick={() => applyProximaImport(def, c)}
                                className="px-2 py-1 rounded-md border border-border bg-background text-[10px] font-medium hover:border-foreground/30 transition-colors"
                              >
                                {c.name}
                              </button>
                            ))}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Picks the token into the form. Click Save below to actually connect.
                          </p>
                        </div>
                      );
                    })()}

                    <div className="bg-muted/30 rounded-md p-2.5">
                      <ol className="text-[10px] text-muted-foreground space-y-0.5 list-decimal ml-3.5">
                        {def.guide.map((s, i) => <li key={i}>{s}</li>)}
                      </ol>
                    </div>

                    {def.fields.map((f) => (
                      <div key={f.key}>
                        <label className="text-xs font-medium block mb-1">
                          {f.label}
                          {!f.required && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
                        </label>
                        {f.sensitive ? (
                          <SensitiveInput
                            value={form.fields[f.key] ?? ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(def.type, f.key, e.target.value)}
                            placeholder={alreadyConfigured ? "•••••••• (leave blank to keep)" : f.placeholder}
                            disabled={!gateway.connected}
                          />
                        ) : (
                          <Input
                            value={form.fields[f.key] ?? ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(def.type, f.key, e.target.value)}
                            placeholder={f.placeholder}
                            disabled={!gateway.connected}
                          />
                        )}
                        {f.helpText && <p className="text-[10px] text-muted-foreground mt-1">{f.helpText}</p>}
                      </div>
                    ))}

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={form.enabled}
                          onChange={() => setEnabled(def.type, !form.enabled)}
                          disabled={!gateway.connected}
                        />
                        <span className="text-xs text-muted-foreground">Enabled</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {alreadyConfigured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            disabled={isSaving || !gateway.connected}
                            onClick={() => handleRemove(def)}
                          >
                            Clear
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isSaving || !gateway.connected}
                          onClick={() => handleSave(def)}
                          title={pendingModel !== undefined ? "Also saves the staged default model" : undefined}
                        >
                          {isSaving
                            ? "Saving..."
                            : pendingModel !== undefined
                              ? "Save (+ model)"
                              : "Save"}
                        </Button>
                      </div>
                    </div>
                    {pendingModel !== undefined && (
                      <p className="text-[10px] text-warning">
                        Saving this channel will also apply the staged default model: <span className="font-mono">{pendingModel}</span>
                      </p>
                    )}

                    {alreadyConfigured && (() => {
                      const test = tests[def.type] ?? DEFAULT_TEST_STATE;
                      const recipientLabel = def.type === "telegram"
                        ? "Chat ID (user or group, numeric)"
                        : def.type === "discord"
                          ? "Channel ID (right-click → Copy ID)"
                          : "Recipient ID";
                      const recipientPlaceholder = def.type === "telegram" ? "123456789" : "987654321098765432";
                      return (
                        <div className="mt-1 pt-3 border-t border-dashed border-border space-y-2">
                          <p className="text-xs font-medium flex items-center gap-1.5">
                            <Send size={12} className="text-muted-foreground" />
                            Send a test message
                          </p>
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">{recipientLabel}</label>
                            <Input
                              value={test.to}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateTest(def.type, { to: e.target.value })}
                              placeholder={recipientPlaceholder}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground block mb-1">Message</label>
                            <Input
                              value={test.message}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateTest(def.type, { message: e.target.value })}
                              placeholder="Test from Proxima"
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={test.sending || !test.to.trim() || !test.message.trim() || !gateway.connected}
                              onClick={() => handleTestSend(def)}
                              leftIcon={<Send size={12} />}
                            >
                              {test.sending ? "Sending..." : "Send test"}
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

    </div>
  );
}
