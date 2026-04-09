"use client";

import React, { useState, useEffect } from "react";
import { SensitiveInput, Input, Button, Badge, useToast } from "@tac-ui/web";
import { Key } from "@tac-ui/icon";
import { api } from "@/lib/api";
import type { OpenClawSettings, OpenClawModels } from "@/types";

interface ModelManagerProps {
  settings: OpenClawSettings | null;
  onSaved?: () => void;
}

interface FieldDef {
  key: keyof OpenClawModels;
  label: string;
  placeholder: string;
  sensitive: boolean; // true = SensitiveInput, false = plain Input
}

interface ProviderDef {
  id: string;
  label: string;
  color: string;
  fields: FieldDef[];
}

const PROVIDER_GROUPS: { title: string; providers: ProviderDef[] }[] = [
  {
    title: "Popular",
    providers: [
      {
        id: "openai", label: "OpenAI", color: "bg-[#10a37f]/15 text-[#10a37f]",
        fields: [{ key: "openaiApiKey", label: "API Key", placeholder: "sk-...", sensitive: true }],
      },
      {
        id: "anthropic", label: "Anthropic", color: "bg-[#d4a574]/15 text-[#d4a574]",
        fields: [{ key: "anthropicApiKey", label: "API Key", placeholder: "sk-ant-...", sensitive: true }],
      },
      {
        id: "gemini", label: "Google Gemini", color: "bg-[#4285f4]/15 text-[#4285f4]",
        fields: [{ key: "geminiApiKey", label: "API Key", placeholder: "AI...", sensitive: true }],
      },
      {
        id: "openrouter", label: "OpenRouter", color: "bg-[#8b5cf6]/15 text-[#8b5cf6]",
        fields: [{ key: "openrouterApiKey", label: "API Key", placeholder: "sk-or-...", sensitive: true }],
      },
    ],
  },
  {
    title: "More Providers",
    providers: [
      {
        id: "deepseek", label: "DeepSeek", color: "bg-[#0066ff]/15 text-[#0066ff]",
        fields: [{ key: "deepseekApiKey", label: "API Key", placeholder: "sk-...", sensitive: true }],
      },
      {
        id: "xai", label: "xAI (Grok)", color: "bg-foreground/10 text-foreground",
        fields: [{ key: "xaiApiKey", label: "API Key", placeholder: "xai-...", sensitive: true }],
      },
      {
        id: "groq", label: "Groq", color: "bg-[#f55036]/15 text-[#f55036]",
        fields: [{ key: "groqApiKey", label: "API Key", placeholder: "gsk_...", sensitive: true }],
      },
      {
        id: "mistral", label: "Mistral", color: "bg-[#ff7000]/15 text-[#ff7000]",
        fields: [{ key: "mistralApiKey", label: "API Key", placeholder: "...", sensitive: true }],
      },
      {
        id: "fireworks", label: "Fireworks", color: "bg-[#e25822]/15 text-[#e25822]",
        fields: [{ key: "fireworksApiKey", label: "API Key", placeholder: "fw_...", sensitive: true }],
      },
      {
        id: "perplexity", label: "Perplexity", color: "bg-[#20b2aa]/15 text-[#20b2aa]",
        fields: [{ key: "perplexityApiKey", label: "API Key", placeholder: "pplx-...", sensitive: true }],
      },
    ],
  },
  {
    title: "Special",
    providers: [
      {
        id: "ollama", label: "Ollama (Local)", color: "bg-muted text-muted-foreground",
        fields: [{ key: "ollamaBaseUrl", label: "Base URL", placeholder: "http://localhost:11434", sensitive: false }],
      },
      {
        id: "azure", label: "Azure OpenAI", color: "bg-[#0078d4]/15 text-[#0078d4]",
        fields: [
          { key: "azureOpenaiApiKey", label: "API Key", placeholder: "...", sensitive: true },
          { key: "azureOpenaiEndpoint", label: "Endpoint URL", placeholder: "https://xxx.openai.azure.com", sensitive: false },
        ],
      },
      {
        id: "cloudflare", label: "Cloudflare AI Gateway", color: "bg-[#f38020]/15 text-[#f38020]",
        fields: [
          { key: "cloudflareAiGwApiKey", label: "API Key", placeholder: "...", sensitive: true },
          { key: "cloudflareAccountId", label: "Account ID", placeholder: "abc123...", sensitive: false },
          { key: "cloudflareGatewayId", label: "Gateway ID", placeholder: "my-gateway", sensitive: false },
        ],
      },
    ],
  },
];

export function ModelManager({ settings, onSaved }: ModelManagerProps) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.models) {
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(settings.models)) {
        if (val) v[k] = val;
      }
      setValues(v);
    }
  }, [settings]);

  const isConfigured = (fields: FieldDef[]) => fields.some(f => values[f.key] && values[f.key].length > 0);
  const isMasked = (key: string) => values[key]?.includes("••") ?? false;

  const handleSave = async (provider: ProviderDef) => {
    setSaving(true);
    try {
      const models: Record<string, string> = {};
      for (const f of provider.fields) {
        const val = values[f.key] ?? "";
        if (!val.includes("••")) {
          models[f.key] = val;
        }
      }
      if (Object.keys(models).length === 0) {
        setEditMode(null);
        setSaving(false);
        return;
      }
      const res = await api.updateOpenClawSettings({ models: models as Partial<OpenClawModels> });
      if (res.ok) {
        toast(`${provider.label} saved`, { variant: "success" });
        setEditMode(null);
        onSaved?.();
      } else {
        toast(res.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  const handleRemove = async (provider: ProviderDef) => {
    setSaving(true);
    try {
      const models: Record<string, string> = {};
      for (const f of provider.fields) {
        models[f.key] = "";
      }
      const res = await api.updateOpenClawSettings({ models: models as Partial<OpenClawModels> });
      if (res.ok) {
        setValues(prev => {
          const next = { ...prev };
          for (const f of provider.fields) delete next[f.key];
          return next;
        });
        toast(`${provider.label} removed`, { variant: "success" });
        setEditMode(null);
        onSaved?.();
      } else {
        toast(res.error ?? "Failed to remove", { variant: "error" });
      }
    } catch {
      toast("Failed to remove", { variant: "error" });
    }
    setSaving(false);
  };

  const renderProvider = (provider: ProviderDef) => {
    const configured = isConfigured(provider.fields);
    const editing = editMode === provider.id;

    return (
      <div key={provider.id} className="border border-border rounded-lg p-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className={`text-[10px] font-semibold px-2 py-1 rounded-md self-start shrink-0 ${provider.color}`}>
            {provider.label}
          </span>

          {editing ? (
            <div className="flex-1 min-w-0 space-y-2">
              {provider.fields.map((f) => (
                <div key={f.key}>
                  {provider.fields.length > 1 && (
                    <label className="text-[10px] font-medium text-muted-foreground block mb-1">{f.label}</label>
                  )}
                  {f.sensitive ? (
                    <SensitiveInput
                      value={values[f.key] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setValues(prev => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <Input
                      value={values[f.key] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setValues(prev => ({ ...prev, [f.key]: e.target.value }))
                      }
                      placeholder={f.placeholder}
                    />
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setEditMode(null)}>Cancel</Button>
                <Button variant="primary" size="sm" disabled={saving} onClick={() => handleSave(provider)}>Save</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                {configured ? (
                  <Badge variant="success">Configured</Badge>
                ) : (
                  <Badge variant="secondary">Not configured</Badge>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    for (const f of provider.fields) {
                      if (isMasked(f.key)) setValues(prev => ({ ...prev, [f.key]: "" }));
                    }
                    setEditMode(provider.id);
                  }}
                >
                  {configured ? "Change" : "Add"}
                </Button>
                {configured && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    onClick={() => handleRemove(provider)}
                    disabled={saving}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Key size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Model Providers</p>
      </div>

      {PROVIDER_GROUPS.map((group) => {
        // Always show "Popular", toggle others
        const isPopular = group.title === "Popular";
        const isExpanded = isPopular || expandedGroup === group.title;

        return (
          <div key={group.title} className="space-y-2">
            {!isPopular && (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                onClick={() => setExpandedGroup(expandedGroup === group.title ? null : group.title)}
              >
                <span className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}>▸</span>
                {group.title}
                <span className="text-[10px]">({group.providers.filter(p => isConfigured(p.fields)).length}/{group.providers.length})</span>
              </button>
            )}
            {isExpanded && (
              <div className="space-y-2">
                {group.providers.map(renderProvider)}
              </div>
            )}
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground">
        API keys are stored securely. Changes are applied automatically.
      </p>
    </div>
  );
}
