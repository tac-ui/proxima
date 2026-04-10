"use client";

import React, { useState, useEffect } from "react";
import { Select, useToast } from "@tac-ui/web";
import { BrainCircuit } from "@tac-ui/icon";
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
  { value: "__g_other", label: "── Other ──", disabled: true },
  { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
  { value: "deepseek/deepseek-reasoner", label: "DeepSeek R1" },
  { value: "xai/grok-3", label: "Grok 3" },
  { value: "zai/glm-4-plus", label: "GLM-4 Plus" },
  { value: "zai/glm-4-air", label: "GLM-4 Air" },
  { value: "zai/glm-4-flash", label: "GLM-4 Flash" },
  { value: "zai/glm-z1-plus", label: "GLM-Z1 Plus" },
  { value: "openrouter/auto", label: "OpenRouter Auto" },
];

export function ModelSelector({ gateway }: ModelSelectorProps) {
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

  const handleChange = async (value: string) => {
    if (!value || value.startsWith("__g_")) return;
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainCircuit size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Default Model</p>
      </div>
      <Select
        options={MODELS}
        value={currentModel}
        onChange={handleChange}
        placeholder="Select a model..."
        disabled={!gateway.connected || saving}
      />
      {currentModel && (
        <p className="text-[10px] text-muted-foreground">
          Using <span className="font-medium">{MODELS.find(m => m.value === currentModel)?.label ?? currentModel}</span>
        </p>
      )}
    </div>
  );
}
