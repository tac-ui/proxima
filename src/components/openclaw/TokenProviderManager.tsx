"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button, Input, SensitiveInput, Badge, Switch, useToast } from "@tac-ui/web";
import { Plus, Trash2, KeyRound } from "@tac-ui/icon";
import { api } from "@/lib/api";

interface Profile {
  profileId: string;
  provider: string;
  hasToken: boolean;
  expires?: number;
  displayName?: string;
}

function formatExpiry(ts?: number): string {
  if (!ts) return "Never expires";
  const diff = ts - Date.now();
  if (diff < 0) return "Expired";
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 30) return `Expires in ${Math.floor(days / 30)}mo`;
  if (days > 0) return `Expires in ${days}d`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  return `Expires in ${hours}h`;
}

export function TokenProviderManager() {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [provider, setProvider] = useState("");
  const [profileId, setProfileId] = useState("");
  const [token, setToken] = useState("");
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("30");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.getOpenClawAuthProfiles();
    if (res.ok && res.data) setProfiles(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setAdding(false);
    setProvider("");
    setProfileId("");
    setToken("");
    setHasExpiry(false);
    setExpiresInDays("30");
  };

  const handleAdd = async () => {
    if (!provider.trim() || !token.trim()) return;
    setSaving(true);
    const res = await api.addOpenClawAuthProfile({
      provider: provider.trim(),
      profileId: profileId.trim() || undefined,
      token: token.trim(),
      expiresInDays: hasExpiry ? parseInt(expiresInDays, 10) || 30 : undefined,
    });
    if (res.ok) {
      toast("Token provider added", { variant: "success" });
      resetForm();
      load();
    } else {
      toast(res.error ?? "Failed to add", { variant: "error" });
    }
    setSaving(false);
  };

  const handleRemove = async (pid: string) => {
    setSaving(true);
    const res = await api.removeOpenClawAuthProfile(pid);
    if (res.ok) {
      toast("Profile removed", { variant: "success" });
      load();
    } else {
      toast(res.error ?? "Failed to remove", { variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-muted-foreground" />
          <p className="text-sm font-medium">Token Providers</p>
        </div>
        {!adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} leftIcon={<Plus size={14} />}>
            Add Provider
          </Button>
        )}
      </div>

      {adding && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">Provider ID</label>
            <Input
              value={provider}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProvider(e.target.value)}
              placeholder="e.g. openai-codex, anthropic, custom-llm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Will be normalized to lowercase with hyphens.</p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Profile ID (optional)</label>
            <Input
              value={profileId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProfileId(e.target.value)}
              placeholder={provider ? `${provider}:manual` : "leave empty for default"}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">Token</label>
            <SensitiveInput
              value={token}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
              placeholder="Paste token..."
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Token expires</p>
              <p className="text-[10px] text-muted-foreground">Set an expiration date for this token</p>
            </div>
            <Switch checked={hasExpiry} onChange={() => setHasExpiry(v => !v)} />
          </div>
          {hasExpiry && (
            <div>
              <label className="text-xs font-medium block mb-1">Expires in (days)</label>
              <Input
                type="number"
                value={expiresInDays}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpiresInDays(e.target.value)}
                placeholder="30"
              />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!provider.trim() || !token.trim() || saving} onClick={handleAdd}>
              {saving ? "Adding..." : "Add Provider"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : profiles.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">No custom token providers. Add one for OAuth tokens or custom API providers.</p>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <div key={p.profileId} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between p-3 rounded-lg border border-border">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-point/15 text-point shrink-0">{p.provider}</span>
                  <span className="text-xs font-mono text-muted-foreground truncate">{p.profileId}</span>
                  {p.hasToken && <Badge variant="success">Token set</Badge>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{formatExpiry(p.expires)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-error hover:text-error self-end sm:self-auto"
                onClick={() => handleRemove(p.profileId)}
                disabled={saving}
                leftIcon={<Trash2 size={14} />}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Custom token providers (e.g. openai-codex, chutes) are stored in auth-profiles.json.
      </p>
    </div>
  );
}
