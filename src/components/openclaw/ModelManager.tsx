"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SensitiveInput, Button, useToast } from "@tac-ui/web";
import { Key, ChevronDown, ExternalLink, Save } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";
import type { OpenClawSettings, OpenClawModels } from "@/types";

interface ModelManagerProps {
  settings: OpenClawSettings | null;
  onSaved?: () => void;
}

const PROVIDERS = [
  { key: "openaiApiKey" as keyof OpenClawModels, label: "OpenAI", placeholder: "sk-...", color: "bg-[#10a37f]/15 text-[#10a37f]", getKeyUrl: "https://platform.openai.com/api-keys" },
  { key: "anthropicApiKey" as keyof OpenClawModels, label: "Anthropic", placeholder: "sk-ant-...", color: "bg-[#d4a574]/15 text-[#d4a574]", getKeyUrl: "https://console.anthropic.com/settings/keys" },
  { key: "geminiApiKey" as keyof OpenClawModels, label: "Gemini", placeholder: "AI...", color: "bg-[#4285f4]/15 text-[#4285f4]", getKeyUrl: "https://aistudio.google.com/apikey" },
  { key: "openrouterApiKey" as keyof OpenClawModels, label: "OpenRouter", placeholder: "sk-or-...", color: "bg-[#8b5cf6]/15 text-[#8b5cf6]", getKeyUrl: "https://openrouter.ai/keys" },
  { key: "moonshotApiKey" as keyof OpenClawModels, label: "Moonshot (Kimi)", placeholder: "sk-...", color: "bg-[#00d4aa]/15 text-[#00d4aa]", getKeyUrl: "https://platform.moonshot.ai/console/api-keys" },
  { key: "zaiApiKey" as keyof OpenClawModels, label: "ZAI (GLM)", placeholder: "...", color: "bg-[#0052cc]/15 text-[#0052cc]", getKeyUrl: "https://docs.z.ai/guides/overview/quick-start" },
];

export function ModelManager({ settings, onSaved }: ModelManagerProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [openProviders, setOpenProviders] = useState<Set<string>>(new Set());

  const serverValue = (key: keyof OpenClawModels): string => {
    const v = settings?.models?.[key];
    return typeof v === "string" ? v : "";
  };

  const isConfigured = (key: keyof OpenClawModels): boolean => serverValue(key).length > 0;

  const clearInput = (key: string) => {
    setInputs(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleProvider = (key: string) => {
    setOpenProviders(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        clearInput(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Collect all dirty (non-empty) inputs
  const dirtyKeys = Object.entries(inputs).filter(([, val]) => val?.trim());
  const hasDirtyInputs = dirtyKeys.length > 0;

  const handleSaveAll = async () => {
    if (!hasDirtyInputs) return;
    setSaving(true);
    try {
      const models: Record<string, string> = {};
      for (const [key, val] of dirtyKeys) {
        models[key] = val.trim();
      }
      const res = await api.updateOpenClawSettings({
        models: models as Partial<OpenClawModels>,
      });
      if (res.ok) {
        toast(`${dirtyKeys.length} API key(s) saved`, { variant: "success" });
        setOpenProviders(new Set());
        setInputs({});
        onSaved?.();
      } else {
        toast(res.error ?? "Failed to save", { variant: "error" });
      }
    } catch {
      toast("Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  const handleRemove = async (providerKey: keyof OpenClawModels) => {
    const providerLabel = PROVIDERS.find(p => p.key === providerKey)?.label ?? String(providerKey);
    const ok = await confirm({
      title: "Remove API key?",
      message: `Remove the ${providerLabel} API key? Models from this provider will no longer be available until you add it again.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const res = await api.updateOpenClawSettings({
        models: { [providerKey]: "" } as Partial<OpenClawModels>,
      });
      if (res.ok) {
        toast("API key removed", { variant: "success" });
        clearInput(providerKey);
        openProviders.delete(providerKey);
        setOpenProviders(new Set(openProviders));
        onSaved?.();
      } else {
        toast(res.error ?? "Failed to remove", { variant: "error" });
      }
    } catch {
      toast("Failed to remove", { variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Key size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Model Providers</p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((p) => {
          const configured = isConfigured(p.key);
          const displayValue = serverValue(p.key);
          const isOpen = openProviders.has(p.key);
          const currentInput = inputs[p.key] ?? "";

          return (
            <div
              key={p.key}
              className={`border rounded-lg overflow-hidden transition-opacity ${
                configured ? "border-border" : "border-border/50 bg-muted/10"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleProvider(p.key)}
                aria-expanded={isOpen}
                aria-label={`${p.label} API key — ${isOpen ? "collapse" : "expand"}`}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
              >
                <span
                  className={`text-[10px] font-semibold px-2 py-1 rounded-md shrink-0 ${
                    configured ? p.color : "bg-muted text-muted-foreground/70"
                  }`}
                >
                  {p.label}
                </span>
                <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate font-mono">
                  {displayValue}
                </span>
                {configured ? (
                  <span
                    className="w-2 h-2 rounded-full bg-success shrink-0"
                    aria-label="Configured"
                  />
                ) : (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 shrink-0 font-medium">
                    Not set
                  </span>
                )}
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
                    <div className="px-3 pb-3 pt-2 space-y-2 border-t border-border">
                      <SensitiveInput
                        value={currentInput}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInputs(prev => ({ ...prev, [p.key]: e.target.value }))}
                        placeholder={configured ? "•••••••• (leave blank to keep)" : p.placeholder}
                      />
                      <div className="flex items-center justify-between">
                        {p.getKeyUrl && !configured && (
                          <a
                            href={p.getKeyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink size={10} />
                            Get an API key from {p.label}
                          </a>
                        )}
                        {configured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            disabled={saving}
                            onClick={() => handleRemove(p.key)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Unified save for all dirty keys */}
      {hasDirtyInputs && (
        <div className="border-t border-border pt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {dirtyKeys.length} key(s) to save
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={saving}
            onClick={handleSaveAll}
            leftIcon={<Save size={12} />}
          >
            {saving ? "Saving..." : "Save All"}
          </Button>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Additional providers can be configured in the Advanced Config section.
      </p>
    </div>
  );
}
