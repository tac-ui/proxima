"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, SensitiveInput, Input, Badge, Switch, useToast } from "@tac-ui/web";
import { Download, ChevronDown } from "@tac-ui/icon";
import { api } from "@/lib/api";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";
import type { OpenClawChannel } from "@/types";

interface ChannelSetupProps {
  gateway: OpenClawGateway;
  channels: OpenClawChannel[];
  onRefresh: () => void;
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

interface ConfigState { hash: string; config: Record<string, unknown>; }
interface FormState { fields: Record<string, string>; enabled: boolean; }

function statusBadge(ch: OpenClawChannel | undefined) {
  if (!ch) return { label: "Not configured", variant: "secondary" as const };
  if (ch.status === "error") return { label: "Error", variant: "error" as const };
  if (!ch.configured) return { label: "Not configured", variant: "secondary" as const };
  if (ch.enabled === false) return { label: "Disabled", variant: "secondary" as const };
  if (ch.status === "connected") return { label: "Connected", variant: "success" as const };
  return { label: "Disconnected", variant: "warning" as const };
}

export function ChannelSetup({ gateway, channels, onRefresh }: ChannelSetupProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormState>>({});

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
    try {
      const state = await gateway.request<ConfigState>("config.get");
      await gateway.request("config.patch", {
        raw: JSON.stringify(patch),
        baseHash: state.hash,
        restartDelayMs: 1000,
      });
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update config", { variant: "error" });
      return false;
    }
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
      setTimeout(onRefresh, 1500);
    }
    setSaving(null);
  };

  const handleRemove = async (def: ChannelDef) => {
    setSaving(def.type);
    const clearConfig: Record<string, unknown> = { enabled: false };
    for (const f of def.fields) {
      clearConfig[f.key] = null;
    }
    const ok = await patchConfig({ channels: { [def.type]: clearConfig } });
    if (ok) {
      toast(`${def.label} cleared`, { variant: "success" });
      setForms(prev => ({ ...prev, [def.type]: { fields: {}, enabled: false } }));
      setTimeout(onRefresh, 1500);
    }
    setSaving(null);
  };

  const handleImportFromProxima = async () => {
    setSaving("__import");
    try {
      const res = await api.getOpenClawImportChannels();
      if (!res.ok || !res.data?.length) {
        toast("No Proxima notification channels found", { variant: "warning" });
        setSaving(null);
        return;
      }
      let imported = 0;
      for (const ch of res.data) {
        if (ch.type === "telegram" && ch.config.botToken) {
          const ok = await patchConfig({
            channels: { telegram: { botToken: ch.config.botToken, enabled: true } },
          });
          if (ok) imported++;
        }
        // Discord notification channels in Proxima use webhook URLs, which
        // aren't compatible with OpenClaw's bot-token requirement.
      }
      if (imported > 0) {
        toast(`Imported ${imported} channel(s) from Proxima`, { variant: "success" });
        setTimeout(onRefresh, 1500);
      } else {
        toast("Only Telegram bot tokens can be imported", { variant: "warning" });
      }
    } catch {
      toast("Failed to import channels", { variant: "error" });
    }
    setSaving(null);
  };

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
                          />
                        ) : (
                          <Input
                            value={form.fields[f.key] ?? ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateField(def.type, f.key, e.target.value)}
                            placeholder={f.placeholder}
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
                        />
                        <span className="text-xs text-muted-foreground">Enabled</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {alreadyConfigured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            disabled={isSaving}
                            onClick={() => handleRemove(def)}
                          >
                            Clear
                          </Button>
                        )}
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={isSaving}
                          onClick={() => handleSave(def)}
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <button
        type="button"
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border transition-colors text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-50"
        onClick={handleImportFromProxima}
        disabled={saving !== null}
      >
        <Download size={14} />
        {saving === "__import" ? "Importing..." : "Import Telegram bot token from Proxima"}
      </button>
    </div>
  );
}
