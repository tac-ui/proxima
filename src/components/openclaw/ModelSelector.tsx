"use client";

import React, { useState, useEffect } from "react";
import { Select, Input, Button, useToast } from "@tac-ui/web";
import { BrainCircuit } from "@tac-ui/icon";
import { api } from "@/lib/api";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";

interface ModelSelectorProps {
  gateway: OpenClawGateway;
}

const MODELS = [
  { value: "", label: "Select a model...", disabled: true },
  { value: "__g_anthropic", label: "── Anthropic ──", disabled: true },
  { value: "anthropic/claude-opus-4-1", label: "Claude Opus 4.1" },
  { value: "anthropic/claude-sonnet-4-1", label: "Claude Sonnet 4.1" },
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
  { value: "__g_openai", label: "── OpenAI ──", disabled: true },
  { value: "openai/gpt-4.1", label: "GPT-4.1" },
  { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { value: "openai/o3", label: "o3" },
  { value: "openai/o4-mini", label: "o4-mini" },
  { value: "__g_google", label: "── Google ──", disabled: true },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "__g_openrouter", label: "── OpenRouter ──", disabled: true },
  { value: "openrouter/auto", label: "OpenRouter Auto (let OpenRouter pick)" },
  { value: "__provider:openrouter", label: "Choose an OpenRouter model..." },
  { value: "__g_other", label: "── Other ──", disabled: true },
  { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { value: "deepseek/deepseek-reasoner", label: "DeepSeek R1" },
  { value: "xai/grok-3", label: "Grok 3" },
  { value: "zai/glm-4-plus", label: "GLM-4 Plus" },
  { value: "zai/glm-4-air", label: "GLM-4 Air" },
  { value: "zai/glm-4-flash", label: "GLM-4 Flash" },
  { value: "zai/glm-z1-plus", label: "GLM-Z1 Plus" },
  { value: "__custom", label: "Enter model ID manually..." },
];

export function ModelSelector({ gateway }: ModelSelectorProps) {
  const { toast } = useToast();
  const [currentModel, setCurrentModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [customProviders, setCustomProviders] = useState<string[]>([]);

  // Load custom providers from auth profiles (independent of gateway).
  // Skip "openrouter" — it has its own built-in entry in the OpenRouter group.
  useEffect(() => {
    api.getOpenClawAuthProfiles().then((res) => {
      if (res.ok && res.data) {
        const unique = [...new Set(res.data.map(p => p.provider))]
          .filter(p => p !== "openrouter");
        setCustomProviders(unique);
      }
    }).catch(() => { /* ignore */ });
  }, []);

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

  const applyModel = async (value: string) => {
    if (!value) return;
    setSaving(true);
    try {
      const state = await gateway.request<{ config: Record<string, unknown>; hash: string }>("config.get");
      await gateway.request("config.patch", {
        raw: JSON.stringify({ agents: { defaults: { model: value } } }),
        baseHash: state.hash,
      });
      setCurrentModel(value);
      setCustomMode(false);
      setCustomModel("");
      toast("Model updated", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update model", { variant: "error" });
    }
    setSaving(false);
  };

  const handleChange = (value: string) => {
    if (value === "__custom") { setCustomMode(true); return; }
    if (value.startsWith("__provider:")) {
      const provider = value.slice("__provider:".length);
      setCustomMode(true);
      setCustomModel(`${provider}/`);
      return;
    }
    if (!value || value.startsWith("__g_")) return;
    applyModel(value);
  };

  // Build options with custom providers group (from auth profiles)
  const allOptions = [
    ...MODELS.slice(0, -1), // all except "Custom model..."
    ...(customProviders.length > 0 ? [
      { value: "__g_custom_providers", label: "── Custom Providers ──", disabled: true },
      ...customProviders.map(p => ({ value: `__provider:${p}`, label: `${p}/... (enter model)` })),
    ] : []),
    MODELS[MODELS.length - 1], // "Custom model..."
  ];

  const isPreset = allOptions.some(m => m.value === currentModel && !(m as { disabled?: boolean }).disabled);

  // When currentModel isn't a preset, see if it matches a provider prefix
  // (openrouter or a user-registered custom provider) so the Select still
  // reflects *which* provider the free-form model belongs to, instead of
  // falling back to the generic "Enter model ID manually..." entry.
  const matchingProvider = !isPreset && currentModel
    ? (currentModel.startsWith("openrouter/")
        ? "openrouter"
        : customProviders.find(p => currentModel.startsWith(`${p}/`)))
    : undefined;

  const selectValue = isPreset
    ? currentModel
    : matchingProvider
      ? `__provider:${matchingProvider}`
      : "__custom";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainCircuit size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Default Model</p>
      </div>
      <Select
        options={allOptions}
        value={selectValue}
        onChange={handleChange}
        placeholder="Select a model..."
        disabled={!gateway.connected || saving}
      />
      {customMode && (() => {
        const isOpenRouter = customModel.startsWith("openrouter/");
        const placeholder = isOpenRouter
          ? "openrouter/anthropic/claude-3.5-sonnet"
          : "provider/model-id";
        const hint = isOpenRouter
          ? "Enter an OpenRouter model slug. Browse them at openrouter.ai/models."
          : "Format: provider/model-id. Use this only for models not listed above.";
        return (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                value={customModel}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomModel(e.target.value)}
                placeholder={placeholder}
                size="sm"
              />
              <Button variant="primary" size="sm" disabled={!customModel.trim() || saving} onClick={() => applyModel(customModel.trim())}>
                Apply
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setCustomMode(false); setCustomModel(""); }}>
                Cancel
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">{hint}</p>
          </div>
        );
      })()}
      {gateway.connected && currentModel && (
        <p className="text-[10px] text-muted-foreground">
          Using <span className="font-medium">{MODELS.find(m => m.value === currentModel)?.label ?? currentModel}</span>
        </p>
      )}
    </div>
  );
}
