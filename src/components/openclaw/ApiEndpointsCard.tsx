"use client";

import React, { useState, useEffect } from "react";
import { Input, Button, useToast } from "@tac-ui/web";
import { Globe } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import type { OpenClawModels } from "@/types";

/**
 * Optional base URL overrides for providers whose SDKs accept a custom
 * endpoint. Leaving a field empty uses the provider default.
 *
 * Injected as env vars on gateway fork:
 *   openaiBaseUrl      → OPENAI_BASE_URL   (LiteLLM, vLLM, local proxies)
 *   anthropicBaseUrl   → ANTHROPIC_BASE_URL (Bedrock bridge, Claude proxy)
 *   ollamaBaseUrl      → OLLAMA_HOST       (remote Ollama host)
 *   azureOpenaiEndpoint→ AZURE_OPENAI_ENDPOINT
 */
const FIELDS: Array<{
  key: keyof OpenClawModels;
  label: string;
  placeholder: string;
  hint: string;
}> = [
  {
    key: "openaiBaseUrl",
    label: "OpenAI base URL",
    placeholder: "https://api.openai.com/v1",
    hint: "OpenAI-compatible endpoint (LiteLLM, vLLM, local proxies)",
  },
  {
    key: "anthropicBaseUrl",
    label: "Anthropic base URL",
    placeholder: "https://api.anthropic.com",
    hint: "Bedrock bridge or Claude-compatible proxy",
  },
  {
    key: "ollamaBaseUrl",
    label: "Ollama host",
    placeholder: "http://localhost:11434",
    hint: "Remote or non-default Ollama instance",
  },
  {
    key: "azureOpenaiEndpoint",
    label: "Azure OpenAI endpoint",
    placeholder: "https://<resource>.openai.azure.com",
    hint: "Your Azure OpenAI resource URL",
  },
];

export function ApiEndpointsCard() {
  const { toast } = useToast();
  const { settings, refreshSettings } = useOpenClaw();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Hydrate from server. URLs are NOT masked so server values render directly.
  useEffect(() => {
    if (!settings) return;
    const next: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = settings.models?.[f.key];
      next[f.key as string] = typeof v === "string" ? v : "";
    }
    setValues(next);
  }, [settings]);

  const dirty = FIELDS.some((f) => {
    const server = (typeof settings?.models?.[f.key] === "string" ? settings.models[f.key] : "") as string;
    return (values[f.key as string] ?? "").trim() !== server.trim();
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const models: Record<string, string> = {};
      for (const f of FIELDS) {
        const key = f.key as string;
        // Trim and pass through — empty string signals removal on the server
        // (saveOpenClawSettings deletes empty model entries).
        models[key] = (values[key] ?? "").trim();
      }
      const res = await api.updateOpenClawSettings({
        models: models as Partial<OpenClawModels>,
      });
      if (res.ok) {
        toast("Endpoints saved — gateway restarted", { variant: "success" });
        await refreshSettings();
      } else {
        toast(res.error ?? "Failed to save", { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Base URLs</p>
      </div>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Leave empty to use the provider default. Set a custom URL to route
        through LiteLLM, a self-hosted proxy, or a regional endpoint.
      </p>

      <div className="space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key as string} className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              {f.label}
            </label>
            <Input
              value={values[f.key as string] ?? ""}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setValues((prev) => ({ ...prev, [f.key as string]: e.target.value }))
              }
              placeholder={f.placeholder}
              disabled={saving}
            />
            <p className="text-[10px] text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end">
        <Button
          variant="primary"
          size="sm"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
