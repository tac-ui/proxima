"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Select, Skeleton, useToast } from "@tac-ui/web";
import { KeyRound, ExternalLink } from "@tac-ui/icon";
import Link from "next/link";
import { api } from "@/lib/api";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import type { SshKeyInfo } from "@/types";

/**
 * Picker for the Git SSH key OpenClaw's agent uses for repo operations
 * (`git clone`, `git pull`, etc.). Keys are managed at the top-level
 * Proxima "SSH Keys" page — this just selects which one to inject as
 * `GIT_SSH_COMMAND` when Proxima forks the gateway process.
 */
export function GitSshKeyCard() {
  const { toast } = useToast();
  const { settings, refreshSettings } = useOpenClaw();
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    const res = await api.getSshKeys();
    if (res.ok && res.data) setSshKeys(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadKeys(); }, [loadKeys]);

  const currentKeyId = settings?.sshKeyId ?? null;
  const currentKey = currentKeyId != null
    ? sshKeys.find(k => k.id === currentKeyId)
    : undefined;

  const handleChange = async (value: string) => {
    const nextId = value === "" ? null : Number(value);
    if (nextId === currentKeyId) return;
    setSaving(true);
    try {
      const res = await api.updateOpenClawSettings({ sshKeyId: nextId });
      if (res.ok) {
        toast(
          nextId === null
            ? "Git SSH key cleared"
            : `Git SSH key set to "${sshKeys.find(k => k.id === nextId)?.alias ?? nextId}"`,
          { variant: "success" },
        );
        await refreshSettings();
      } else {
        toast(res.error ?? "Failed to update SSH key", { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update SSH key", { variant: "error" });
    }
    setSaving(false);
  };

  const options = [
    { value: "", label: "None — use agent's default auth" },
    ...sshKeys.map(k => ({ value: String(k.id), label: `${k.alias}${k.keyPath ? ` (${k.keyPath})` : ""}` })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Git SSH Key</p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground leading-relaxed">
        <p className="font-medium text-foreground mb-1">How it works</p>
        <p>
          OpenClaw&apos;s agent runs git commands (<code className="font-mono">git clone</code>, <code className="font-mono">git pull</code>, etc.)
          from the workspace. Selecting a key here injects{" "}
          <code className="font-mono">GIT_SSH_COMMAND</code> with that private key path so the agent can
          authenticate against your Git remotes (GitHub, GitLab, self-hosted).
        </p>
        <p className="mt-1">
          Manage keys on the{" "}
          <Link href="/ssh-keys" className="text-foreground font-medium underline underline-offset-2 hover:text-point">
            SSH Keys page
          </Link>.
        </p>
      </div>

      {loading ? (
        <Skeleton height={36} />
      ) : sshKeys.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 flex items-start gap-2 text-xs">
          <KeyRound size={14} className="text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <p className="font-medium">No SSH keys registered.</p>
            <p className="text-muted-foreground">
              Register a key on the SSH Keys page first, then come back to link it to OpenClaw.
            </p>
            <Link
              href="/ssh-keys"
              className="inline-flex items-center gap-1 text-[10px] text-foreground font-medium underline underline-offset-2 hover:text-point"
            >
              <ExternalLink size={10} />
              Open SSH Keys
            </Link>
          </div>
        </div>
      ) : (
        <>
          <Select
            options={options}
            value={currentKeyId == null ? "" : String(currentKeyId)}
            onChange={handleChange}
            placeholder="Select an SSH key..."
            disabled={saving}
          />
          {currentKey && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Active key</p>
              <p className="text-xs font-medium truncate" title={currentKey.alias}>
                {currentKey.alias}
              </p>
              {currentKey.keyPath && (
                <p className="text-[10px] text-muted-foreground font-mono truncate" title={currentKey.keyPath}>
                  {currentKey.keyPath}
                </p>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Changing this setting automatically restarts the gateway so it picks up the new env.
          </p>
        </>
      )}
    </div>
  );
}
