"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SensitiveInput, Button, useToast } from "@tac-ui/web";
import { Key, ChevronDown } from "@tac-ui/icon";
import { api } from "@/lib/api";
import type { OpenClawSettings, OpenClawModels } from "@/types";

interface ModelManagerProps {
  settings: OpenClawSettings | null;
  onSaved?: () => void;
}

const PROVIDERS = [
  { key: "openaiApiKey" as keyof OpenClawModels, label: "OpenAI", placeholder: "sk-...", color: "bg-[#10a37f]/15 text-[#10a37f]" },
  { key: "anthropicApiKey" as keyof OpenClawModels, label: "Anthropic", placeholder: "sk-ant-...", color: "bg-[#d4a574]/15 text-[#d4a574]" },
  { key: "geminiApiKey" as keyof OpenClawModels, label: "Gemini", placeholder: "AI...", color: "bg-[#4285f4]/15 text-[#4285f4]" },
  { key: "openrouterApiKey" as keyof OpenClawModels, label: "OpenRouter", placeholder: "sk-or-...", color: "bg-[#8b5cf6]/15 text-[#8b5cf6]" },
  { key: "zaiApiKey" as keyof OpenClawModels, label: "ZAI (GLM)", placeholder: "...", color: "bg-[#0052cc]/15 text-[#0052cc]" },
];

export function ModelManager({ settings, onSaved }: ModelManagerProps) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.models) {
      const v: Record<string, string> = {};
      for (const [k, val] of Object.entries(settings.models)) {
        if (val) v[k] = val;
      }
      setValues(v);
    }
  }, [settings]);

  const isConfigured = (key: string) => values[key] && values[key].length > 0;
  const isMasked = (key: string) => values[key]?.includes("••") ?? false;

  const handleSave = async (providerKey: string) => {
    setSaving(true);
    try {
      const val = values[providerKey] ?? "";
      if (val.includes("••")) { setEditMode(null); setSaving(false); return; }
      const res = await api.updateOpenClawSettings({ models: { [providerKey]: val } as Partial<OpenClawModels> });
      if (res.ok) {
        toast("API key saved", { variant: "success" });
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

  const handleRemove = async (providerKey: string) => {
    setSaving(true);
    try {
      const res = await api.updateOpenClawSettings({ models: { [providerKey]: "" } as Partial<OpenClawModels> });
      if (res.ok) {
        setValues(prev => { const next = { ...prev }; delete next[providerKey]; return next; });
        toast("API key removed", { variant: "success" });
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Key size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Model Providers</p>
      </div>

      <div className="space-y-2">
        {PROVIDERS.map((p) => {
          const configured = isConfigured(p.key);
          const editing = editMode === p.key;
          const displayValue = configured ? values[p.key] ?? "" : "";

          const toggleOpen = () => {
            if (editing) {
              setEditMode(null);
              return;
            }
            if (isMasked(p.key)) {
              setValues(prev => ({ ...prev, [p.key]: "" }));
            }
            setEditMode(p.key);
          };

          return (
            <div key={p.key} className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={toggleOpen}
                className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
              >
                <span className={`text-[10px] font-semibold px-2 py-1 rounded-md shrink-0 ${p.color}`}>
                  {p.label}
                </span>
                <span className="flex-1 min-w-0 text-xs text-muted-foreground truncate font-mono">
                  {displayValue || <span className="font-sans italic">Not set</span>}
                </span>
                {configured && (
                  <span className="w-2 h-2 rounded-full bg-success shrink-0" aria-label="Configured" />
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
                        value={values[p.key] ?? ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setValues(prev => ({ ...prev, [p.key]: e.target.value }))}
                        placeholder={p.placeholder}
                      />
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
                        <Button variant="ghost" size="sm" onClick={() => setEditMode(null)}>
                          Cancel
                        </Button>
                        <Button variant="primary" size="sm" disabled={saving} onClick={() => handleSave(p.key)}>
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
