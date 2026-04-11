"use client";

import React, { useState, useEffect } from "react";
import { Input, SensitiveInput, Button, useToast } from "@tac-ui/web";
import { GitBranch, ExternalLink, Check } from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useOpenClaw } from "@/contexts/OpenClawContext";

/**
 * Git commit identity + GitHub PAT editor. The openclaw service injects
 * these as env vars on gateway start:
 *
 *   GIT_AUTHOR_NAME / GIT_COMMITTER_NAME  ← gitUserName
 *   GIT_AUTHOR_EMAIL / GIT_COMMITTER_EMAIL ← gitUserEmail
 *   GH_TOKEN / GITHUB_TOKEN               ← githubToken
 *
 * Combined with the Git SSH key above, the agent has everything it needs
 * to `git clone`, commit, push, and run `gh pr create`.
 */
export function GitIdentityCard() {
  const { toast } = useToast();
  const { settings, refreshSettings } = useOpenClaw();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  // Hydrate from server settings. The server masks githubToken, so we
  // render the mask as a placeholder and keep the local input empty
  // until the user types — same pattern as ModelManager API keys.
  useEffect(() => {
    if (!settings) return;
    setName(settings.gitUserName ?? "");
    setEmail(settings.gitUserEmail ?? "");
    setToken(""); // never prefill the masked token
  }, [settings]);

  const tokenConfigured = !!(settings?.githubToken && settings.githubToken.length > 0);

  const dirty =
    (settings?.gitUserName ?? "") !== name.trim() ||
    (settings?.gitUserEmail ?? "") !== email.trim() ||
    token.trim().length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {
        gitUserName: name.trim(),
        gitUserEmail: email.trim(),
      };
      // Only include token if user actually typed one — an empty string
      // here would wipe the stored token, which the user rarely wants.
      if (token.trim().length > 0) {
        payload.githubToken = token.trim();
      }
      const res = await api.updateOpenClawSettings(payload);
      if (res.ok) {
        toast("Git identity saved — gateway restarted", { variant: "success" });
        setToken("");
        await refreshSettings();
      } else {
        toast(res.error ?? "Failed to save git identity", { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save git identity", { variant: "error" });
    }
    setSaving(false);
  };

  const handleClearToken = async () => {
    setSaving(true);
    try {
      const res = await api.updateOpenClawSettings({ githubToken: "" });
      if (res.ok) {
        toast("GitHub token cleared", { variant: "success" });
        setToken("");
        await refreshSettings();
      } else {
        toast(res.error ?? "Failed to clear token", { variant: "error" });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear token", { variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <GitBranch size={14} className="text-muted-foreground" />
        <p className="text-sm font-medium">Git Identity & GitHub Token</p>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground leading-relaxed space-y-1">
        <p className="font-medium text-foreground">How it works</p>
        <p>
          The agent needs three things to commit and open PRs:
        </p>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>
            <strong>Git identity</strong> — injected as{" "}
            <code className="font-mono">GIT_AUTHOR_NAME / EMAIL</code> and the matching{" "}
            <code className="font-mono">COMMITTER</code> pair, so commits are attributed correctly.
          </li>
          <li>
            <strong>SSH key</strong> — already configured above; used for{" "}
            <code className="font-mono">git push</code>.
          </li>
          <li>
            <strong>GitHub token</strong> — injected as{" "}
            <code className="font-mono">GH_TOKEN</code> /{" "}
            <code className="font-mono">GITHUB_TOKEN</code> so the agent can run{" "}
            <code className="font-mono">gh pr create</code> (the{" "}
            <code className="font-mono">gh</code> CLI is preinstalled in the Proxima image).
          </li>
        </ul>
        <p className="pt-1">
          Use a PAT with <code className="font-mono">repo</code> +{" "}
          <code className="font-mono">workflow</code> scopes, or a fine-grained token limited to the
          repos you want the agent to touch.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Name
          </label>
          <Input
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            placeholder="OpenClaw Agent"
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Email
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            placeholder="agent@example.com"
            disabled={saving}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              GitHub Token
            </label>
            {tokenConfigured && (
              <span className="inline-flex items-center gap-1 text-[10px] text-success">
                <Check size={10} />
                Configured
              </span>
            )}
          </div>
          <SensitiveInput
            value={token}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
            placeholder={tokenConfigured ? "•••••••• (leave blank to keep)" : "ghp_... or github_pat_..."}
            disabled={saving}
          />
          <a
            href="https://github.com/settings/tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink size={10} />
            Create a token on GitHub
          </a>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {tokenConfigured && (
          <Button
            variant="ghost"
            size="sm"
            className="text-error hover:text-error mr-auto"
            disabled={saving}
            onClick={handleClearToken}
          >
            Clear token
          </Button>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Saving automatically restarts the gateway so the new env vars take effect.
      </p>
    </div>
  );
}
