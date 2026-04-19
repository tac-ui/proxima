"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Select, Input, Button, Skeleton, useToast } from "@tac-ui/web";
import { BrainCircuit, Pencil, AlertCircle, Save, X, Copy, Check } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import type { OpenClawModels } from "@/types";

// ---------------------------------------------------------------------------
// Model catalog — grouped by provider so we can filter by registered API key
// ---------------------------------------------------------------------------

interface ModelEntry { value: string; label: string; }

interface ModelGroup {
  id: string;
  header: string;
  /** Which field in settings.models must be set for this group to appear. */
  requiresKey: keyof OpenClawModels;
  models: ModelEntry[];
  /** Optional dynamic "pick custom model" entry within the group. */
  pickEntry?: {
    /** Provider prefix used when entering a free-form model (e.g. "openrouter"). */
    providerPrefix: string;
    defaultLabel: string;
  };
}

const MODEL_GROUPS: ModelGroup[] = [
  {
    id: "anthropic",
    header: "── Anthropic ──",
    requiresKey: "anthropicApiKey",
    models: [
      { value: "anthropic/claude-opus-4-1", label: "Claude Opus 4.1" },
      { value: "anthropic/claude-sonnet-4-1", label: "Claude Sonnet 4.1" },
      { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai",
    header: "── OpenAI ──",
    requiresKey: "openaiApiKey",
    models: [
      { value: "openai/gpt-4.1", label: "GPT-4.1" },
      { value: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
      { value: "openai/o3", label: "o3" },
      { value: "openai/o4-mini", label: "o4-mini" },
    ],
  },
  {
    id: "google",
    header: "── Google ──",
    requiresKey: "geminiApiKey",
    models: [
      { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "openrouter",
    header: "── OpenRouter ──",
    requiresKey: "openrouterApiKey",
    models: [
      { value: "openrouter/auto", label: "OpenRouter Auto (let OpenRouter pick)" },
    ],
    pickEntry: {
      providerPrefix: "openrouter",
      defaultLabel: "Choose an OpenRouter model...",
    },
  },
  {
    id: "moonshot",
    header: "── Moonshot (Kimi) ──",
    requiresKey: "moonshotApiKey",
    models: [
      { value: "moonshot/kimi-k2.5", label: "Kimi K2.5" },
      { value: "moonshot/kimi-k2-thinking", label: "Kimi K2 Thinking" },
    ],
    pickEntry: {
      providerPrefix: "moonshot",
      defaultLabel: "Choose a Kimi model...",
    },
  },
  {
    id: "zai",
    header: "── ZAI (GLM) ──",
    requiresKey: "zaiApiKey",
    models: [
      { value: "zai/glm-4-plus", label: "GLM-4 Plus" },
      { value: "zai/glm-4-air", label: "GLM-4 Air" },
      { value: "zai/glm-4-flash", label: "GLM-4 Flash" },
      { value: "zai/glm-z1-plus", label: "GLM-Z1 Plus" },
    ],
  },
  {
    id: "deepseek",
    header: "── DeepSeek ──",
    requiresKey: "deepseekApiKey",
    models: [
      { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
      { value: "deepseek/deepseek-reasoner", label: "DeepSeek R1" },
    ],
  },
  {
    id: "xai",
    header: "── xAI ──",
    requiresKey: "xaiApiKey",
    models: [
      { value: "xai/grok-3", label: "Grok 3" },
    ],
  },
  {
    id: "ollama",
    header: "── Ollama (Local) ──",
    requiresKey: "ollamaBaseUrl",
    models: [],
    pickEntry: {
      providerPrefix: "ollama",
      defaultLabel: "Enter Ollama model...",
    },
  },
];

/** Flat lookup of all preset model IDs across every group. */
const ALL_PRESET_MODELS: ModelEntry[] = MODEL_GROUPS.flatMap(g => g.models);

const CUSTOM_MANUAL = { value: "__custom", label: "Enter model ID manually..." };

/** Strips a provider prefix for display. "openrouter/anthropic/claude-3.5" → "anthropic/claude-3.5" */
function stripProviderPrefix(modelId: string, provider: string): string {
  return modelId.startsWith(`${provider}/`) ? modelId.slice(provider.length + 1) : modelId;
}

/**
 * Friendly label for the current model. Returns a human-readable name
 * when we have one, otherwise `null` so the caller can skip rendering
 * (avoids showing the raw ID twice — once in the mono line above, once
 * in the "friendly" line below).
 */
function friendlyModelLabel(modelId: string): string | null {
  const preset = ALL_PRESET_MODELS.find(m => m.value === modelId);
  if (preset) return preset.label;
  if (modelId === "openrouter/auto") return "OpenRouter Auto";
  // Free-form model: derive a short tail name for readability if possible.
  // "openrouter/z-ai/glm-4.5-air:free" → "glm-4.5-air:free"
  const slash = modelId.lastIndexOf("/");
  if (slash > 0 && slash < modelId.length - 1) {
    const tail = modelId.slice(slash + 1);
    return tail !== modelId ? tail : null;
  }
  return null;
}

/** Extract the configured default model from an openclaw config object. */
function extractDefaultModel(config: Record<string, unknown> | null): string {
  if (!config) return "";
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const model = defaults?.model;
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "primary" in (model as Record<string, unknown>)) {
    return (model as Record<string, string>).primary ?? "";
  }
  return "";
}

export function ModelSelector() {
  const { toast } = useToast();
  const {
    gateway,
    config,
    configLoading,
    settings,
    pendingModel,
    committing,
    stageModel,
    discardPendingModel,
    commitPendingPatch,
  } = useOpenClaw();
  const [customMode, setCustomMode] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [customProviders, setCustomProviders] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

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

  // Derive the currently-saved model from the shared config cache.
  const savedModel = useMemo(() => extractDefaultModel(config), [config]);
  // The "current" model we render is the pending one if the user has
  // staged a change, otherwise the committed value from the gateway config.
  const currentModel = pendingModel ?? savedModel;
  const hasPendingChange = pendingModel !== undefined && pendingModel !== savedModel;

  // Filter provider groups to only those whose API key / base URL is set.
  // `settings.models` values are either "" (unset) or a masked string
  // (configured) coming from the Proxima API.
  const hasKey = (key: keyof OpenClawModels): boolean => {
    const val = settings?.models?.[key];
    return typeof val === "string" && val.length > 0;
  };
  const visibleGroups = useMemo(
    () => MODEL_GROUPS.filter(g => hasKey(g.requiresKey)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings?.models],
  );

  const stagePreset = (value: string) => {
    if (!value) return;
    // If the user re-picks the model that's already committed, clear the
    // pending state instead of staging a no-op.
    if (value === savedModel) {
      discardPendingModel();
    } else {
      stageModel(value);
    }
    setCustomMode(false);
    setCustomModel("");
  };

  const handleSaveModel = useCallback(async () => {
    if (pendingModel === undefined || pendingModel === savedModel) return;
    const ok = await commitPendingPatch();
    if (ok) {
      toast("Model saved", { variant: "success" });
    } else {
      toast("Failed to save model", { variant: "error" });
    }
  }, [pendingModel, savedModel, commitPendingPatch, toast]);

  const handleRevertModel = () => {
    discardPendingModel();
    setCustomMode(false);
    setCustomModel("");
  };

  const handleCopyModel = async () => {
    if (!currentModel) return;
    try {
      await navigator.clipboard.writeText(currentModel);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Failed to copy", { variant: "error" });
    }
  };

  // Ctrl/Cmd + S saves the pending model when one is staged. This matches
  // the FileManager editor shortcut so power users get consistent behavior
  // across the app. Skipped while input/textarea has focus so typing into
  // a field doesn't trigger a save instead of a text char.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== "s" && e.key !== "S") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      if (!pendingModel || committing || !gateway.connected) return;
      e.preventDefault();
      void handleSaveModel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingModel, committing, gateway.connected, handleSaveModel]);

  const handleChange = (value: string) => {
    if (value === "__custom") {
      setCustomMode(true);
      setCustomModel("");
      return;
    }
    if (value.startsWith("__provider:")) {
      const provider = value.slice("__provider:".length);
      // Seed with the current model if it's already on this provider, so the
      // user can edit the existing value instead of starting from scratch.
      const seed = currentModel.startsWith(`${provider}/`) ? currentModel : `${provider}/`;
      setCustomMode(true);
      setCustomModel(seed);
      return;
    }
    if (!value || value.startsWith("__g_")) return;
    stagePreset(value);
  };

  // Is the currently-stored model one of the presets across all visible groups?
  const isCurrentVisiblePreset = ALL_PRESET_MODELS.some(m => m.value === currentModel)
    && visibleGroups.some(g => g.models.some(m => m.value === currentModel));

  // When currentModel isn't a static preset, see if it matches a provider
  // prefix (openrouter or a user-registered custom provider) so the Select
  // still reflects *which* provider the free-form model belongs to.
  const matchingProvider = !isCurrentVisiblePreset && currentModel
    ? (currentModel.startsWith("openrouter/") && currentModel !== "openrouter/auto"
        ? "openrouter"
        : customProviders.find(p => currentModel.startsWith(`${p}/`))
          ?? MODEL_GROUPS.find(g => g.pickEntry && currentModel.startsWith(`${g.pickEntry.providerPrefix}/`))?.pickEntry?.providerPrefix)
    : undefined;

  // Build the dropdown option list from visible groups.
  const allOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
    { value: "", label: "Select a model...", disabled: true },
  ];

  for (const group of visibleGroups) {
    allOptions.push({ value: `__g_${group.id}`, label: group.header, disabled: true });
    for (const model of group.models) {
      allOptions.push(model);
    }
    if (group.pickEntry) {
      const { providerPrefix, defaultLabel } = group.pickEntry;
      const isActive = currentModel.startsWith(`${providerPrefix}/`)
        && currentModel !== `${providerPrefix}/auto`
        && !group.models.some(m => m.value === currentModel);
      const label = isActive
        ? `${providerPrefix} · ${stripProviderPrefix(currentModel, providerPrefix)}`
        : defaultLabel;
      allOptions.push({ value: `__provider:${providerPrefix}`, label });
    }
  }

  if (customProviders.length > 0) {
    allOptions.push({ value: "__g_custom_providers", label: "── Custom Providers ──", disabled: true });
    for (const p of customProviders) {
      const isActive = matchingProvider === p;
      const label = isActive
        ? `${p} · ${stripProviderPrefix(currentModel, p)}`
        : `${p}/... (enter model)`;
      allOptions.push({ value: `__provider:${p}`, label });
    }
  }

  allOptions.push(CUSTOM_MANUAL);

  const selectValue = isCurrentVisiblePreset
    ? currentModel
    : matchingProvider
      ? `__provider:${matchingProvider}`
      : currentModel
        ? "__custom"
        : "";

  const hasSelection = Boolean(currentModel);

  // Skeleton state: config hasn't arrived yet (first load after connect).
  const skeletonMode = config === null && configLoading;

  // Empty state: no providers configured at all (no API keys AND no custom
  // providers). Show a helpful hint pointing to the Credentials tab.
  const noProviders = visibleGroups.length === 0 && customProviders.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <BrainCircuit size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Default Model</p>
      </div>

      {skeletonMode ? (
        <>
          <Skeleton height={36} />
          <Skeleton height={56} />
        </>
      ) : noProviders ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 flex items-start gap-2 text-xs">
          <AlertCircle size={14} className="text-warning shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-medium">No providers registered yet.</p>
            <p className="text-muted-foreground">
              Register at least one API key under <span className="font-medium text-foreground">Credentials → API Keys</span> to see models here,
              or use <span className="font-medium text-foreground">Enter model ID manually</span> below if your model doesn&apos;t need a key.
            </p>
            <Select
              options={[
                { value: "", label: "Select a model...", disabled: true },
                CUSTOM_MANUAL,
              ]}
              value={selectValue}
              onChange={handleChange}
              placeholder="Select a model..."
              disabled={!gateway.connected || committing}
            />
          </div>
        </div>
      ) : (
        <>
          <Select
            options={allOptions}
            value={selectValue}
            onChange={handleChange}
            placeholder="Select a model..."
            disabled={!gateway.connected || committing}
          />

          {/* Prominent current-model card. Label flips from "Current model"
              to "Pending change" when the user has staged but not saved. */}
          {hasSelection && !customMode && (
            <div
              className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${
                hasPendingChange
                  ? "border-warning/50 bg-warning/5"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] uppercase tracking-wide ${hasPendingChange ? "text-warning" : "text-muted-foreground"}`}>
                  {hasPendingChange ? "Pending model (unsaved)" : "Current model"}
                </p>
                {(() => {
                  const friendly = friendlyModelLabel(currentModel);
                  // Show friendly name as primary line + full ID as secondary
                  // (in mono font). If we don't have a friendly name, fall
                  // back to showing the full ID once only — no duplication.
                  if (friendly && friendly !== currentModel) {
                    return (
                      <>
                        <p className="text-sm font-medium truncate" title={friendly}>
                          {friendly}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono truncate" title={currentModel}>
                          {currentModel}
                        </p>
                      </>
                    );
                  }
                  return (
                    <p className="text-xs font-mono truncate" title={currentModel}>
                      {currentModel}
                    </p>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyModel}
                  title="Copy model ID"
                  aria-label="Copy model ID"
                >
                  {copied ? (
                    <Check size={12} className="text-success" />
                  ) : (
                    <Copy size={12} />
                  )}
                </Button>
                {matchingProvider && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!gateway.connected || committing}
                    onClick={() => {
                      setCustomMode(true);
                      setCustomModel(currentModel);
                    }}
                    leftIcon={<Pencil size={11} />}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>
          )}

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
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!customModel.trim() || committing || !gateway.connected}
                    onClick={() => stagePreset(customModel.trim())}
                  >
                    Apply
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setCustomMode(false); setCustomModel(""); }}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {hint} Changes are staged — click Save at the top of the card (or save any channel) to apply.
                </p>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
