"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input, SensitiveInput, Switch, Skeleton, useToast } from "@tac-ui/web";
import { Plus, Trash2, KeyRound, ChevronDown, Sparkles } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";

interface Profile {
  profileId: string;
  provider: string;
  hasToken: boolean;
  expires?: number;
  displayName?: string;
}

function formatExpiry(ts?: number): { label: string; variant: "muted" | "warning" | "error" } {
  if (!ts) return { label: "Never expires", variant: "muted" };
  const diff = ts - Date.now();
  if (diff < 0) return { label: "Expired", variant: "error" };
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 30) return { label: `Expires in ${Math.floor(days / 30)}mo`, variant: "muted" };
  if (days > 7) return { label: `Expires in ${days}d`, variant: "muted" };
  if (days > 0) return { label: `Expires in ${days}d`, variant: "warning" };
  const hours = Math.floor(diff / (60 * 60 * 1000));
  return { label: `Expires in ${hours}h`, variant: "warning" };
}

export function TokenProviderManager() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const handleRemove = async (p: Profile) => {
    const ok = await confirm({
      title: "Remove token provider?",
      message: `Remove "${p.profileId}"? Any models using this provider will fail until you add it again.`,
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (!ok) return;
    setSaving(true);
    const res = await api.removeOpenClawAuthProfile(p.profileId);
    if (res.ok) {
      toast("Profile removed", { variant: "success" });
      if (expandedId === p.profileId) setExpandedId(null);
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
          {profiles.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({profiles.length})</span>
          )}
        </div>
        {!adding && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} leftIcon={<Plus size={14} />}>
            Add Provider
          </Button>
        )}
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-1">How to use a registered provider</p>
        <ol className="list-decimal ml-4 space-y-0.5">
          <li>Add the provider below with the API key or OAuth token.</li>
          <li>Go to <span className="font-medium text-foreground">Setup → Model</span> and open the dropdown.</li>
          <li>
            The provider appears under <span className="font-medium text-foreground">Custom Providers</span>.
            Pick it, then enter the model ID (e.g. <code className="font-mono text-foreground">{"<provider>/<model-name>"}</code>).
          </li>
        </ol>
      </div>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
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
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border">
              <Skeleton variant="circular" width={14} height={14} />
              <div className="flex-1 space-y-1">
                <Skeleton width={160} height={12} />
                <Skeleton width={100} height={10} />
              </div>
              <Skeleton width={60} height={20} />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && profiles.length === 0 && !adding && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="rounded-lg border border-dashed border-border px-4 py-6 flex flex-col items-center text-center gap-2"
        >
          <div className="w-10 h-10 rounded-full bg-info/10 flex items-center justify-center">
            <Sparkles size={16} className="text-info" />
          </div>
          <p className="text-xs font-medium">No custom token providers yet</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Register OAuth tokens or keys for providers that aren&apos;t in the standard API Keys list
            (e.g. <code className="font-mono">openai-codex</code>, <code className="font-mono">chutes</code>).
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} leftIcon={<Plus size={14} />}>
            Add first provider
          </Button>
        </motion.div>
      )}

      {/* Profile list as collapsible cards */}
      {!loading && profiles.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {profiles.map((p) => {
              const isExpanded = expandedId === p.profileId;
              const expiry = formatExpiry(p.expires);
              const expiryColor =
                expiry.variant === "error" ? "text-error"
                : expiry.variant === "warning" ? "text-warning"
                : "text-muted-foreground";
              return (
                <motion.div
                  key={p.profileId}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : p.profileId)}
                    aria-expanded={isExpanded}
                    aria-label={`${p.profileId} — ${isExpanded ? "collapse" : "expand"}`}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-md shrink-0 bg-point/15 text-point">
                      {p.provider}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono truncate">{p.profileId}</p>
                      {p.displayName && (
                        <p className="text-[10px] text-muted-foreground truncate">{p.displayName}</p>
                      )}
                    </div>
                    {p.hasToken && (
                      <span className="w-2 h-2 rounded-full bg-success shrink-0" aria-label="Token set" />
                    )}
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="shrink-0 text-muted-foreground"
                    >
                      <ChevronDown size={14} />
                    </motion.span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pt-2 border-t border-border space-y-2">
                          <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-[11px]">
                            <dt className="text-muted-foreground">Provider</dt>
                            <dd className="font-mono">{p.provider}</dd>
                            <dt className="text-muted-foreground">Profile ID</dt>
                            <dd className="font-mono truncate" title={p.profileId}>{p.profileId}</dd>
                            {p.displayName && (
                              <>
                                <dt className="text-muted-foreground">Display name</dt>
                                <dd className="truncate">{p.displayName}</dd>
                              </>
                            )}
                            <dt className="text-muted-foreground">Token</dt>
                            <dd className={p.hasToken ? "text-success" : "text-muted-foreground"}>
                              {p.hasToken ? "Configured" : "Not set"}
                            </dd>
                            <dt className="text-muted-foreground">Expires</dt>
                            <dd className={expiryColor}>{expiry.label}</dd>
                          </dl>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-error hover:text-error"
                              onClick={() => handleRemove(p)}
                              disabled={saving}
                              leftIcon={<Trash2 size={14} />}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Custom token providers (e.g. openai-codex, chutes) are stored in <code className="font-mono">auth-profiles.json</code>.
      </p>
    </div>
  );
}
