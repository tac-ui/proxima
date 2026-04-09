"use client";

import React, { useState } from "react";
import { Button, SensitiveInput, Input, Badge, Switch, useToast } from "@tac-ui/web";
import { Wifi, WifiOff } from "@tac-ui/icon";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";
import type { OpenClawChannel } from "@/types";

// ---------------------------------------------------------------------------
// Channel definitions
// ---------------------------------------------------------------------------

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
  guide: { title: string; steps: string[] };
}

function SvgIcon({ d, size = 16, color }: { d: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color ?? "currentColor"}><path d={d} /></svg>;
}

const CHANNELS: ChannelDef[] = [
  {
    type: "telegram", label: "Telegram",
    icon: <SvgIcon d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />,
    color: "bg-[#26A5E4]/15 text-[#26A5E4]", borderColor: "border-[#26A5E4]/30 bg-[#26A5E4]/5",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456789:ABCdefGHI...", sensitive: true, required: true },
      { key: "allowFrom", label: "Allowed User IDs", placeholder: "123456789, 987654321", sensitive: false, required: false, helpText: "Find your ID via @userinfobot" },
    ],
    guide: { title: "How to set up:", steps: ["Open Telegram, search @BotFather", "Send /newbot and follow prompts", "Copy the bot token"] },
  },
  {
    type: "discord", label: "Discord",
    icon: <SvgIcon d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />,
    color: "bg-[#5865F2]/15 text-[#5865F2]", borderColor: "border-[#5865F2]/30 bg-[#5865F2]/5",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "MTk4NjIz...", sensitive: true, required: true },
    ],
    guide: { title: "How to set up:", steps: ["Go to Discord Developer Portal", "Create New Application → Bot section", "Reset Token and copy it", "Enable Message Content Intent", "Invite bot to your server"] },
  },
  {
    type: "slack", label: "Slack",
    icon: <SvgIcon d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />,
    color: "bg-[#4A154B]/15 text-[#4A154B]", borderColor: "border-[#4A154B]/30 bg-[#4A154B]/5",
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "xoxb-...", sensitive: true, required: true },
      { key: "appToken", label: "App Token", placeholder: "xapp-...", sensitive: true, required: true },
    ],
    guide: { title: "How to set up:", steps: ["Go to api.slack.com/apps", "Create New App → From scratch", "Add Bot Token Scopes", "Install to Workspace", "Copy Bot Token & App Token"] },
  },
  {
    type: "whatsapp", label: "WhatsApp",
    icon: <SvgIcon d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />,
    color: "bg-[#25D366]/15 text-[#25D366]", borderColor: "border-[#25D366]/30 bg-[#25D366]/5",
    fields: [],
    guide: { title: "WhatsApp requires pairing:", steps: ["Start OpenClaw gateway", "Run pairing via CLI or scan QR code", "WhatsApp connects automatically"] },
  },
  {
    type: "signal", label: "Signal",
    icon: <SvgIcon d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 17.08c-.153.153-.395.2-.605.117a11.34 11.34 0 01-2.136-1.137c-.183-.122-.35-.265-.525-.4-.56.316-1.17.55-1.808.692a7.238 7.238 0 01-1.82.231 7.238 7.238 0 01-1.82-.23 7.163 7.163 0 01-1.808-.693c-.175.135-.342.278-.525.4a11.34 11.34 0 01-2.136 1.137c-.21.083-.452.036-.605-.117a.474.474 0 01-.117-.605 11.34 11.34 0 011.137-2.136c.107-.16.223-.313.34-.467A7.148 7.148 0 014.5 12c0-4.136 3.364-7.5 7.5-7.5s7.5 3.364 7.5 7.5a7.148 7.148 0 01-.966 3.584c.117.154.233.307.34.467a11.34 11.34 0 011.137 2.136.474.474 0 01-.117.605z" />,
    color: "bg-[#3A76F0]/15 text-[#3A76F0]", borderColor: "border-[#3A76F0]/30 bg-[#3A76F0]/5",
    fields: [],
    guide: { title: "Signal requires CLI setup:", steps: ["Install signal-cli on host", "Link device via QR code or phone number", "Configure in OpenClaw Advanced settings"] },
  },
  {
    type: "matrix", label: "Matrix",
    icon: <SvgIcon d="M.632.55v22.9H2.28V24H0V0h2.28v.55zm7.043 7.26v1.157h.033c.309-.443.683-.784 1.117-1.024.433-.245.936-.365 1.5-.365.54 0 1.033.107 1.488.32.45.214.773.553.96 1.016.293-.344.66-.645 1.104-.9.445-.256.954-.384 1.512-.384.42 0 .816.056 1.185.168.37.112.694.294.97.54.278.246.496.567.653.96.157.394.236.87.236 1.43v5.496h-1.903v-4.618c0-.286-.012-.56-.036-.817a1.74 1.74 0 00-.192-.66.99.99 0 00-.444-.44c-.197-.106-.467-.16-.812-.16-.345 0-.625.07-.84.208a1.424 1.424 0 00-.487.517 2.07 2.07 0 00-.233.693 4.63 4.63 0 00-.06.738v4.54H9.492v-4.49c0-.255-.004-.51-.012-.762a2.08 2.08 0 00-.148-.666 1.06 1.06 0 00-.415-.49c-.19-.13-.466-.192-.828-.192a1.92 1.92 0 00-.388.052 1.26 1.26 0 00-.468.216 1.39 1.39 0 00-.404.48c-.112.21-.168.494-.168.852v4.8H4.763V7.81h1.812zm14.045 15.64v-22.9H21.72V0H24v24h-2.28v-.55z" />,
    color: "bg-foreground/10 text-foreground", borderColor: "border-border bg-muted/50",
    fields: [
      { key: "homeserver", label: "Homeserver URL", placeholder: "https://matrix.org", sensitive: false, required: true },
      { key: "userId", label: "User ID", placeholder: "@bot:matrix.org", sensitive: false, required: true },
      { key: "accessToken", label: "Access Token", placeholder: "syt_...", sensitive: true, required: true },
    ],
    guide: { title: "How to set up:", steps: ["Create a bot account on your Matrix server", "Get an access token via login API", "Enter homeserver, user ID, and token"] },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ConfigState { hash: string; config: Record<string, unknown>; }

export function ChannelSetup({ gateway, channels, onRefresh }: ChannelSetupProps) {
  const { toast } = useToast();
  const [adding, setAdding] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

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

  const handleConnect = async (channel: ChannelDef) => {
    // Validate required fields
    for (const f of channel.fields) {
      if (f.required && !fieldValues[f.key]?.trim()) {
        toast(`${f.label} is required`, { variant: "error" });
        return;
      }
    }

    setSaving(true);
    const config: Record<string, unknown> = { enabled: true };
    for (const f of channel.fields) {
      const val = fieldValues[f.key]?.trim();
      if (val) {
        // Special: allowFrom is comma-separated numbers
        if (f.key === "allowFrom") {
          const ids = val.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
          if (ids.length > 0) {
            config.allowFrom = ids;
            config.dmPolicy = "allowlist";
          }
        } else {
          config[f.key] = val;
        }
      }
    }

    const ok = await patchConfig({ channels: { [channel.type]: config } });
    if (ok) {
      toast(`${channel.label} connected!`, { variant: "success" });
      setAdding(null);
      setFieldValues({});
      setTimeout(onRefresh, 2000);
    }
    setSaving(false);
  };

  const handleToggle = async (type: string, enabled: boolean) => {
    setSaving(true);
    const ok = await patchConfig({ channels: { [type]: { enabled } } });
    if (ok) {
      toast(`Channel ${enabled ? "enabled" : "disabled"}`, { variant: "success" });
      setTimeout(onRefresh, 2000);
    }
    setSaving(false);
  };

  const addingChannel = CHANNELS.find(c => c.type === adding);
  const existingTypes = new Set(channels.map(c => c.type));

  return (
    <div className="space-y-3">
      {/* Connected channels */}
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
                {ch.name && <p className="text-[10px] text-muted-foreground">{ch.name}</p>}
              </div>
            </div>
            <Switch
              checked={ch.status === "connected"}
              onChange={() => handleToggle(ch.type, ch.status !== "connected")}
              disabled={saving}
            />
          </div>
        );
      })}

      {/* Setup wizard */}
      {addingChannel && (
        <div className={`border rounded-xl p-5 space-y-4 ${addingChannel.borderColor}`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${addingChannel.color}`}>
              {addingChannel.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Connect {addingChannel.label}</h3>
            </div>
          </div>

          {/* Guide */}
          <div className="bg-background rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium">{addingChannel.guide.title}</p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal ml-4">
              {addingChannel.guide.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>

          {/* Fields */}
          {addingChannel.fields.length > 0 ? (
            <div className="space-y-3">
              {addingChannel.fields.map((f) => (
                <div key={f.key}>
                  <label className="text-sm font-medium block mb-1.5">
                    {f.label} {!f.required && <span className="text-muted-foreground font-normal">(optional)</span>}
                  </label>
                  {f.sensitive ? (
                    <SensitiveInput
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <Input
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                    />
                  )}
                  {f.helpText && <p className="text-[10px] text-muted-foreground mt-1">{f.helpText}</p>}
                </div>
              ))}
              <div className="flex justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setAdding(null); setFieldValues({}); }}>Cancel</Button>
                <Button variant="primary" size="sm" disabled={saving} onClick={() => handleConnect(addingChannel)}>
                  {saving ? "Connecting..." : `Connect ${addingChannel.label}`}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(null); setFieldValues({}); }}>Close</Button>
            </div>
          )}
        </div>
      )}

      {/* Add channel buttons */}
      {!adding && (
        <div className="flex gap-2 flex-wrap">
          {CHANNELS.filter(c => !existingTypes.has(c.type)).map((ch) => (
            <button
              key={ch.type}
              type="button"
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed transition-all text-xs text-muted-foreground hover:text-foreground ${ch.borderColor.replace("bg-", "hover:bg-")}`}
              onClick={() => setAdding(ch.type)}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center ${ch.color}`}>{ch.icon}</span>
              {ch.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ChannelSetupProps {
  gateway: OpenClawGateway;
  channels: OpenClawChannel[];
  onRefresh: () => void;
}
