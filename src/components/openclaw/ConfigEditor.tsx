"use client";

import React, { useState, useEffect } from "react";
import { Button, Skeleton, useToast } from "@tac-ui/web";
import { Save, RefreshCw } from "@tac-ui/icon";
import { useOpenClaw } from "@/contexts/OpenClawContext";

export function ConfigEditor() {
  const { toast } = useToast();
  const { gateway, config, configHash, configLoading, refreshConfig } = useOpenClaw();
  const [saving, setSaving] = useState(false);
  const [rawJson, setRawJson] = useState("");
  const [rawJsonError, setRawJsonError] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sync editor buffer with the shared config cache whenever it refreshes,
  // unless the user has unsaved changes in the textarea.
  useEffect(() => {
    if (!config) return;
    if (dirty) return;
    setRawJson(JSON.stringify(config, null, 2));
    setRawJsonError("");
  }, [config, dirty]);

  const handleSave = async () => {
    try {
      JSON.parse(rawJson);
      setRawJsonError("");
    } catch (err) {
      setRawJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    if (!configHash) {
      toast("Config not loaded yet — try Reload first", { variant: "error" });
      return;
    }
    setSaving(true);
    try {
      await gateway.request("config.set", {
        raw: rawJson,
        baseHash: configHash,
      });
      toast("Config saved", { variant: "success" });
      setDirty(false);
      // Refresh the shared cache so ModelSelector / ChannelSetup etc.
      // pick up the new values and a fresh hash.
      await refreshConfig();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  const handleReload = async () => {
    setDirty(false);
    await refreshConfig();
  };

  // Skeleton on first load (no config cached yet AND gateway never connected
  // long enough to populate the cache).
  if (config === null) {
    if (!gateway.connected) {
      return (
        <p className="text-sm text-muted-foreground text-center py-4">
          Gateway not connected. Start OpenClaw to view configuration.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton width={260} height={14} />
          <Skeleton width={80} height={28} />
        </div>
        <Skeleton height={320} />
      </div>
    );
  }

  // When the gateway is disconnected/reconnecting, we keep the cached
  // config visible as read-only so users don't lose context, but Save and
  // the textarea are locked. The Setup tab already shows a banner so we
  // don't duplicate the status here.
  const readOnly = !gateway.connected;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Edit the raw OpenClaw configuration (openclaw.json)
          {configLoading && <span className="ml-2 italic">· refreshing...</span>}
          {readOnly && <span className="ml-2 italic text-warning">· read-only (gateway offline)</span>}
        </p>
        <Button variant="ghost" size="sm" onClick={handleReload} leftIcon={<RefreshCw size={14} />} disabled={configLoading || readOnly}>
          Reload
        </Button>
      </div>
      <textarea
        value={rawJson}
        readOnly={readOnly}
        onChange={(e) => {
          setRawJson(e.target.value);
          setDirty(true);
          try { JSON.parse(e.target.value); setRawJsonError(""); } catch (err) { setRawJsonError(err instanceof Error ? err.message : "Invalid JSON"); }
        }}
        rows={16}
        spellCheck={false}
        className={`w-full px-4 py-3 text-xs font-mono rounded-lg border border-border bg-muted text-foreground outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed ${readOnly ? "opacity-70 cursor-not-allowed" : ""}`}
      />
      {rawJsonError && <p className="text-xs text-error">{rawJsonError}</p>}
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={saving || !!rawJsonError || !dirty || readOnly} onClick={handleSave} leftIcon={<Save size={14} />}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
