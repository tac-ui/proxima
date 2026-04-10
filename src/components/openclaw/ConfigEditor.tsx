"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button, useToast } from "@tac-ui/web";
import { Save, RefreshCw } from "@tac-ui/icon";
import type { OpenClawGateway } from "@/hooks/useOpenClawGateway";

interface ConfigEditorProps {
  gateway: OpenClawGateway;
}

interface ConfigState {
  config: Record<string, unknown>;
  hash: string;
}

export function ConfigEditor({ gateway }: ConfigEditorProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [rawJsonError, setRawJsonError] = useState("");

  const loadConfig = useCallback(async () => {
    if (!gateway.connected) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await gateway.request<ConfigState>("config.get");
      setRawJson(JSON.stringify(result.config, null, 2));
      setRawJsonError("");
    } catch {
      toast("Failed to load config", { variant: "error" });
    }
    setLoading(false);
  }, [gateway, toast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    try {
      JSON.parse(rawJson);
      setRawJsonError("");
    } catch (err) {
      setRawJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    setSaving(true);
    try {
      const fresh = await gateway.request<ConfigState>("config.get");
      await gateway.request("config.set", {
        raw: rawJson,
        baseHash: fresh.hash,
      });
      toast("Config saved", { variant: "success" });
      await loadConfig();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  if (!gateway.connected) {
    return <p className="text-sm text-muted-foreground text-center py-4">Gateway not connected. Start OpenClaw to edit configuration.</p>;
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Edit the raw OpenClaw configuration (openclaw.json)</p>
        <Button variant="ghost" size="sm" onClick={loadConfig} leftIcon={<RefreshCw size={14} />}>
          Reload
        </Button>
      </div>
      <textarea
        value={rawJson}
        onChange={(e) => {
          setRawJson(e.target.value);
          try { JSON.parse(e.target.value); setRawJsonError(""); } catch (err) { setRawJsonError(err instanceof Error ? err.message : "Invalid JSON"); }
        }}
        rows={16}
        spellCheck={false}
        className="w-full px-4 py-3 text-xs font-mono rounded-lg border border-border bg-muted text-foreground outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed"
      />
      {rawJsonError && <p className="text-xs text-error">{rawJsonError}</p>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={saving || !!rawJsonError} onClick={handleSave} leftIcon={<Save size={14} />}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
