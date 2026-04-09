"use client";

import React, { useState, useEffect } from "react";
import { Select, useToast } from "@tac-ui/web";
import { BrainCircuit } from "@tac-ui/icon";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";

interface ModelSelectorProps {
  gateway: OpenClawGateway;
  configuredProviders?: string[];
}

const PROVIDER_MODELS: { group: string; models: { id: string; name: string }[] }[] = [
  {
    group: "Anthropic",
    models: [
      { id: "anthropic/claude-opus-4-1", name: "Claude Opus 4.1" },
      { id: "anthropic/claude-sonnet-4-1", name: "Claude Sonnet 4.1" },
      { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    group: "OpenAI",
    models: [
      { id: "openai/gpt-4.1", name: "GPT-4.1" },
      { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "openai/o3", name: "o3" },
      { id: "openai/o4-mini", name: "o4-mini" },
    ],
  },
  {
    group: "Google",
    models: [
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    group: "DeepSeek",
    models: [
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
      { id: "deepseek/deepseek-reasoner", name: "DeepSeek R1" },
    ],
  },
  {
    group: "xAI",
    models: [
      { id: "xai/grok-3", name: "Grok 3" },
      { id: "xai/grok-3-mini", name: "Grok 3 Mini" },
    ],
  },
  {
    group: "Others",
    models: [
      { id: "openrouter/auto", name: "OpenRouter Auto" },
      { id: "groq/llama-3.3-70b-versatile", name: "Groq Llama 3.3 70B" },
      { id: "mistral/mistral-large-latest", name: "Mistral Large" },
      { id: "perplexity/sonar-pro", name: "Perplexity Sonar Pro" },
    ],
  },
];

export function ModelSelector({ gateway, configuredProviders }: ModelSelectorProps) {
  const { toast } = useToast();
  const [currentModel, setCurrentModel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gateway.connected) return;
    const load = async () => {
      try {
        const result = await gateway.request<{ config: Record<string, unknown>; hash: string }>("config.get");
        const agents = result.config.agents as Record<string, unknown> | undefined;
        const defaults = agents?.defaults as Record<string, unknown> | undefined;
        const model = defaults?.model;
        if (typeof model === "string") setCurrentModel(model);
        else if (model && typeof model === "object" && "primary" in (model as Record<string, unknown>)) {
          setCurrentModel((model as Record<string, string>).primary);
        }
      } catch { /* ignore */ }
    };
    load();
  }, [gateway]);

  // Map provider groups to their API key prefix for filtering
  const PROVIDER_KEY_MAP: Record<string, string> = {
    Anthropic: "anthropic", OpenAI: "openai", Google: "google",
    DeepSeek: "deepseek", xAI: "xai", Others: "",
  };

  const options = PROVIDER_MODELS.flatMap((g) => {
    const providerKey = PROVIDER_KEY_MAP[g.group];
    const isConfigured = !providerKey || !configuredProviders || configuredProviders.includes(providerKey);
    return [
      { value: `__group_${g.group}`, label: `── ${g.group}${!isConfigured ? " (no key)" : ""} ──`, disabled: true },
      ...g.models.map((m) => ({
        value: m.id,
        label: isConfigured ? m.name : `${m.name} (no API key)`,
        disabled: !isConfigured,
      })),
    ];
  });

  const handleChange = async (value: string) => {
    if (!value || value.startsWith("__group_")) return;
    setSaving(true);
    try {
      const state = await gateway.request<{ config: Record<string, unknown>; hash: string }>("config.get");
      await gateway.request("config.patch", {
        raw: JSON.stringify({ agents: { defaults: { model: value } } }),
        baseHash: state.hash,
      });
      setCurrentModel(value);
      toast("Model updated", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update model", { variant: "error" });
    }
    setSaving(false);
  };

  const currentLabel = PROVIDER_MODELS
    .flatMap(g => g.models)
    .find(m => m.id === currentModel)?.name ?? currentModel;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainCircuit size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Default Model</p>
      </div>
      <Select
        options={options}
        value={currentModel}
        onChange={handleChange}
        placeholder="Select a model..."
        disabled={!gateway.connected || saving}
      />
      {currentModel && (
        <p className="text-[10px] text-muted-foreground">
          Using <span className="font-medium">{currentLabel}</span>
        </p>
      )}
    </div>
  );
}
