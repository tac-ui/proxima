"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SensitiveInput, Button, useToast } from "@tac-ui/web";
import { Key, ChevronDown, ExternalLink } from "@tac-ui/icon";
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
  // User input buffer, keyed by provider. Cleared after save / cancel.
  // Never reflects server state so the collapsed header stays stable.
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<string | null>(null);

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

  const handleSave = async (providerKey: keyof OpenClawModels) => {
    const val = inputs[providerKey]?.trim() ?? "";
    if (!val) return;
    setSaving(true);
    try {
      const res = await api.updateOpenClawSettings({
        models: { [providerKey]: val } as Partial<OpenClawModels>,
      });
      if (res.ok) {
        toast("API key saved", { variant: "success" });
        setEditMode(null);
        clearInput(providerKey);
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
        setEditMode(null);
        clearInput(providerKey);
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
          const editing = editMode === p.key;
          const currentInput = inputs[p.key] ?? "";

          const toggleOpen = () => {
            if (editing) {
              setEditMode(null);
              clearInput(p.key);
            } else {
              setEditMode(p.key);
            }
          };

          const cancelEdit = () => {
            setEditMode(null);
            clearInput(p.key);
          };

          return (
            <div
              key={p.key}
              className={`border rounded-lg overflow-hidden transition-opacity ${
                configured ? "border-border" : "border-border/50 bg-muted/10"
              }`}
            >
              <button
                type="button"
                onClick={toggleOpen}
                aria-expanded={editing}
                aria-label={`${p.label} API key — ${editing ? "collapse" : "expand"}`}
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
                  animate={{ rotate: editing ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="shrink-0 text-muted-foreground"
                >
                  <ChevronDown size={14} />
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {editing && (
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
                      <div className="flex items-center justify-end gap-2">
                        {configured && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error mr-auto"
                            disabled={saving}
                            onClick={() => handleRemove(p.key)}
                          >
                            Remove
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={cancelEdit}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={saving || !currentInput.trim()}
                          onClick={() => handleSave(p.key)}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Additional providers can be configured in the Advanced Config section.
      </p>
    </div>
  );
}
