"use client";

import React, { useState } from "react";
import { Button, SensitiveInput, Input, Badge, Switch, useToast } from "@tac-ui/web";
import { Wifi, WifiOff, Download } from "@tac-ui/icon";
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
    type: "telegram", label: "Telegram",
    icon: <SvgIcon d={TG_ICON} />,
    color: "bg-[#26A5E4]/15 text-[#26A5E4]", borderColor: "border-[#26A5E4]/30 bg-[#26A5E4]/5",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456789:ABCdefGHI...", sensitive: true, required: true },
      { key: "allowFrom", label: "Allowed User IDs", placeholder: "123456789, 987654321", sensitive: false, required: false, helpText: "Find your ID via @userinfobot" },
    ],
    guide: ["Open Telegram, search @BotFather", "Send /newbot and follow prompts", "Copy the bot token"],
  },
  {
    type: "discord", label: "Discord",
    icon: <SvgIcon d={DC_ICON} />,
    color: "bg-[#5865F2]/15 text-[#5865F2]", borderColor: "border-[#5865F2]/30 bg-[#5865F2]/5",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "MTk4NjIz...", sensitive: true, required: true },
    ],
    guide: ["Go to Discord Developer Portal", "Create New Application → Bot section", "Reset Token, copy it, enable Message Content Intent"],
  },
];

interface ConfigState { hash: string; config: Record<string, unknown>; }

export function ChannelSetup({ gateway, channels, onRefresh }: ChannelSetupProps) {
  const { toast } = useToast();
  const [adding, setAdding] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const patchConfig = async (patch: Record<string, unknown>): Promise<boolean> => {
    try {
      const state = await gateway.request<ConfigState>("config.get");
      await gateway.request("config.patch", { raw: JSON.stringify(patch), baseHash: state.hash, restartDelayMs: 1000 });
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update config", { variant: "error" });
      return false;
    }
  };

  const handleConnect = async (channel: ChannelDef) => {
    for (const f of channel.fields) {
      if (f.required && !fieldValues[f.key]?.trim()) { toast(`${f.label} is required`, { variant: "error" }); return; }
    }
    setSaving(true);
    const config: Record<string, unknown> = { enabled: true };
    for (const f of channel.fields) {
      const val = fieldValues[f.key]?.trim();
      if (val) {
        if (f.key === "allowFrom") {
          const ids = val.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
          if (ids.length > 0) { config.allowFrom = ids; config.dmPolicy = "allowlist"; }
        } else { config[f.key] = val; }
      }
    }
    const ok = await patchConfig({ channels: { [channel.type]: config } });
    if (ok) { toast(`${channel.label} connected!`, { variant: "success" }); setAdding(null); setFieldValues({}); setTimeout(onRefresh, 2000); }
    setSaving(false);
  };

  const handleToggle = async (type: string, enabled: boolean) => {
    setSaving(true);
    const ok = await patchConfig({ channels: { [type]: { enabled } } });
    if (ok) { toast(`Channel ${enabled ? "enabled" : "disabled"}`, { variant: "success" }); setTimeout(onRefresh, 2000); }
    setSaving(false);
  };

  const handleImportFromProxima = async () => {
    setSaving(true);
    try {
      const res = await api.getOpenClawImportChannels();
      if (!res.ok || !res.data?.length) { toast("No Proxima notification channels found", { variant: "warning" }); setSaving(false); return; }

      let imported = 0;
      for (const ch of res.data) {
        if (ch.type === "telegram" && ch.config.botToken) {
          const ok = await patchConfig({ channels: { telegram: { botToken: ch.config.botToken, enabled: true } } });
          if (ok) imported++;
        }
        if (ch.type === "discord" && ch.config.botToken) {
          const ok = await patchConfig({ channels: { discord: { token: ch.config.botToken, enabled: true } } });
          if (ok) imported++;
        }
      }

      if (imported > 0) {
        toast(`Imported ${imported} channel(s) from Proxima`, { variant: "success" });
        setTimeout(onRefresh, 2000);
      } else {
        toast("No compatible channels to import (Telegram/Discord only)", { variant: "warning" });
      }
    } catch {
      toast("Failed to import channels", { variant: "error" });
    }
    setSaving(false);
  };

  const addingChannel = CHANNELS.find(c => c.type === adding);
  const existingTypes = new Set(channels.map(c => c.type));

  return (
    <div className="space-y-3">
      {channels.map((ch) => {
        const def = CHANNELS.find(c => c.type === ch.type);
        return (
          <div key={ch.type} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-3 rounded-lg border border-border">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${def?.color ?? "bg-muted text-muted-foreground"}`}>
                {def?.icon ?? (ch.status === "connected" ? <Wifi size={16} /> : <WifiOff size={16} />)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{def?.label ?? ch.type}</p>
                  <Badge variant={ch.status === "connected" ? "success" : "secondary"}>
                    {ch.status === "connected" ? "Online" : "Offline"}
                  </Badge>
                </div>
              </div>
            </div>
            <Switch checked={ch.status === "connected"} onChange={() => handleToggle(ch.type, ch.status !== "connected")} disabled={saving} />
          </div>
        );
      })}

      {addingChannel && (
        <div className={`border rounded-xl p-5 space-y-4 ${addingChannel.borderColor}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${addingChannel.color}`}>{addingChannel.icon}</div>
            <h3 className="text-sm font-semibold">Connect {addingChannel.label}</h3>
          </div>
          <div className="bg-background rounded-lg p-3">
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal ml-4">
              {addingChannel.guide.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
          {addingChannel.fields.map((f) => (
            <div key={f.key}>
              <label className="text-sm font-medium block mb-1.5">
                {f.label} {!f.required && <span className="text-muted-foreground font-normal">(optional)</span>}
              </label>
              {f.sensitive ? (
                <SensitiveInput value={fieldValues[f.key] ?? ""} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} />
              ) : (
                <Input value={fieldValues[f.key] ?? ""} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))} placeholder={f.placeholder} />
              )}
              {f.helpText && <p className="text-[10px] text-muted-foreground mt-1">{f.helpText}</p>}
            </div>
          ))}
          <div className="flex justify-between">
            <Button variant="ghost" size="sm" onClick={() => { setAdding(null); setFieldValues({}); }}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={saving} onClick={() => handleConnect(addingChannel)}>
              {saving ? "Connecting..." : `Connect ${addingChannel.label}`}
            </Button>
          </div>
        </div>
      )}

      {!adding && (
        <div className="flex gap-2 flex-wrap">
          {CHANNELS.filter(c => !existingTypes.has(c.type)).map((ch) => (
            <button key={ch.type} type="button" className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed transition-all text-xs text-muted-foreground hover:text-foreground ${ch.borderColor}`} onClick={() => setAdding(ch.type)}>
              <span className={`w-5 h-5 rounded flex items-center justify-center ${ch.color}`}>{ch.icon}</span>
              {ch.label}
            </button>
          ))}
          <button type="button" className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border transition-all text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30" onClick={handleImportFromProxima} disabled={saving}>
            <Download size={14} />
            Import from Proxima
          </button>
        </div>
      )}
    </div>
  );
}
