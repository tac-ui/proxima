"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirm } from "@/hooks/useConfirm";
import { api } from "@/lib/api";
import type { SshKeyInfo } from "@/types";
import {
  Card,
  CardHeader,
  CardContent,
  Input,
  Button,
  Modal,
  ModalHeader,
  ModalTitle,
  ModalFooter,
  Skeleton,
  useToast,
  pageEntrance,
} from "@tac-ui/web";
import { KeyRound, Plus, Copy, Check, Trash2, ShieldAlert } from "@tac-ui/icon";
import { LoadingIndicator } from "@/components/shared/LoadingIndicator";

export default function SshKeysPage() {
  const { isManager } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [sshKeysLoaded, setSshKeysLoaded] = useState(false);
  const [showGenerateKey, setShowGenerateKey] = useState(false);
  const [newKeyAlias, setNewKeyAlias] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedPublicKey, setGeneratedPublicKey] = useState("");
  const [copiedKeyId, setCopiedKeyId] = useState<number | null>(null);

  const loadSshKeys = useCallback(async () => {
    try {
      const res = await api.getSshKeys();
      if (res.ok && res.data) {
        setSshKeys(res.data);
        setSshKeysLoaded(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (isManager) loadSshKeys();
  }, [isManager, loadSshKeys]);

  const handleGenerateKey = async () => {
    setGenerating(true);
    try {
      const res = await api.generateSshKey(newKeyAlias);
      if (res.ok && res.data) {
        toast("SSH key generated", { variant: "success" });
        setGeneratedPublicKey(res.data.publicKey);
        setNewKeyAlias("");
        loadSshKeys();
      } else {
        toast(res.error ?? "Failed to generate key", { variant: "error" });
      }
    } catch {
      toast("Failed to generate key", { variant: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteSshKey = async (key: SshKeyInfo) => {
    const confirmed = await confirm({
      title: "Delete SSH Key",
      message: `Delete "${key.alias}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    try {
      const res = await api.removeSshKey(key.id);
      if (res.ok) {
        toast("SSH key deleted", { variant: "success" });
        loadSshKeys();
      } else {
        toast(res.error ?? "Failed to delete key", { variant: "error" });
      }
    } catch {
      toast("Failed to delete key", { variant: "error" });
    }
  };

  const handleCopyPublicKey = async (keyId: number) => {
    try {
      const res = await api.getSshPublicKey(keyId);
      if (res.ok && res.data?.publicKey) {
        await navigator.clipboard.writeText(res.data.publicKey);
        setCopiedKeyId(keyId);
        toast("Public key copied to clipboard", { variant: "success" });
        setTimeout(() => setCopiedKeyId(null), 2000);
      } else {
        toast("Public key not available", { variant: "error" });
      }
    } catch {
      toast("Failed to copy public key", { variant: "error" });
    }
  };

  if (!isManager) {
    return (
      <motion.div className="max-w-screen-md mx-auto" {...pageEntrance}>
        <Card>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldAlert size={48} className="text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground">You don&apos;t have permission to manage Git SSH keys.</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="max-w-screen-md mx-auto space-y-6"
      {...pageEntrance}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-success/15 flex items-center justify-center">
                <KeyRound size={18} className="text-success" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">SSH Keys for Git</h2>
                <p className="text-xs text-muted-foreground">Manage SSH keys used for Git clone and pull operations</p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => { setShowGenerateKey(true); setGeneratedPublicKey(""); }}
            >
              Generate Key
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <LoadingIndicator visible={!sshKeysLoaded} className="pb-4" />
          {!sshKeysLoaded ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </div>
          ) : sshKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No SSH keys configured</p>
          ) : (
            <div className="space-y-3">
              {sshKeys.map((key) => (
                <div key={key.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-medium">{key.alias}</p>
                    <p className="text-xs text-muted-foreground font-mono">{key.keyPath}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyPublicKey(key.id)}
                      leftIcon={copiedKeyId === key.id ? <Check size={14} /> : <Copy size={14} />}
                    >
                      {copiedKeyId === key.id ? "Copied" : "Public Key"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteSshKey(key)}
                      leftIcon={<Trash2 size={14} />}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>

        {/* Generate Key Modal */}
        <Modal open={showGenerateKey} onClose={() => setShowGenerateKey(false)} size="sm">
          <ModalHeader>
            <ModalTitle>Generate SSH Key</ModalTitle>
          </ModalHeader>
          <div className="px-6 pb-2 space-y-4">
            {generatedPublicKey ? (
              <div className="space-y-3">
                <p className="text-sm text-success font-medium">Key generated successfully!</p>
                <div>
                  <p className="text-xs font-medium mb-1.5">Public Key (add this to GitHub)</p>
                  <div className="relative">
                    <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto break-all whitespace-pre-wrap border border-border font-mono">
                      {generatedPublicKey}
                    </pre>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-1.5 right-1.5"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedPublicKey);
                        toast("Copied to clipboard", { variant: "success" });
                      }}
                      leftIcon={<Copy size={12} />}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <Input
                label="Key Alias"
                value={newKeyAlias}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKeyAlias(e.target.value)}
                placeholder="e.g. github-deploy"
              />
            )}
          </div>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setShowGenerateKey(false)}>
              {generatedPublicKey ? "Close" : "Cancel"}
            </Button>
            {!generatedPublicKey && (
              <Button
                variant="primary"
                disabled={generating || !newKeyAlias}
                onClick={handleGenerateKey}
              >
                {generating ? "Generating..." : "Generate"}
              </Button>
            )}
          </ModalFooter>
        </Modal>
      </Card>
    </motion.div>
  );
}
