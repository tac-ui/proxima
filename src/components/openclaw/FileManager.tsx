"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button, Input, useToast } from "@tac-ui/web";
import { Plus, Trash2, FileText, Save } from "@tac-ui/icon";
import { api } from "@/lib/api";

interface FileEntry { name: string; size: number; }

export function FileManager() {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const res = await api.getOpenClawFiles();
    if (res.ok && res.data) setFiles(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleOpen = async (name: string) => {
    const res = await api.readOpenClawFile(name);
    if (res.ok && res.data) {
      setEditing(name);
      setContent(res.data.content);
    } else {
      toast(res.error ?? "Failed to read file", { variant: "error" });
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const res = await api.writeOpenClawFile(editing, content);
    if (res.ok) {
      toast("File saved", { variant: "success" });
      loadFiles();
    } else {
      toast(res.error ?? "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await api.writeOpenClawFile(newName.trim(), "");
    if (res.ok) {
      toast("File created", { variant: "success" });
      setCreating(false);
      setNewName("");
      await loadFiles();
      handleOpen(newName.trim());
    } else {
      toast(res.error ?? "Failed to create", { variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async (name: string) => {
    const res = await api.deleteOpenClawFile(name);
    if (res.ok) {
      toast("File deleted", { variant: "success" });
      if (editing === name) { setEditing(null); setContent(""); }
      loadFiles();
    } else {
      toast(res.error ?? "Failed to delete", { variant: "error" });
    }
  };

  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-muted-foreground" />
            <p className="text-sm font-medium">{editing}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setContent(""); }}>Close</Button>
            <Button variant="primary" size="sm" disabled={saving} onClick={handleSave} leftIcon={<Save size={14} />}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full px-4 py-3 text-xs font-mono rounded-lg border border-border bg-muted text-foreground outline-none focus:ring-1 focus:ring-ring resize-y leading-relaxed"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-muted-foreground" />
          <p className="text-sm font-medium">Files</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)} leftIcon={<Plus size={14} />}>
          New File
        </Button>
      </div>

      {creating && (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
            placeholder="e.g. USER.md"
            size="sm"
          />
          <Button variant="primary" size="sm" disabled={!newName.trim() || saving} onClick={handleCreate}>Create</Button>
          <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : files.length === 0 && !creating ? (
        <p className="text-xs text-muted-foreground">No files. Create USER.md or CLAUDE.md to configure the assistant.</p>
      ) : (
        <div className="space-y-1">
          {files.map((f) => (
            <div key={f.name} className="flex items-center justify-between p-2 rounded-lg border border-border hover:border-foreground/20 transition-colors group">
              <button type="button" className="flex items-center gap-2 text-xs font-mono min-w-0 truncate" onClick={() => handleOpen(f.name)}>
                <FileText size={12} className="text-muted-foreground shrink-0" />
                <span className="truncate">{f.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{f.size}B</span>
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-error transition-colors sm:opacity-0 sm:group-hover:opacity-100 p-1"
                onClick={() => handleDelete(f.name)}
                aria-label={`Delete ${f.name}`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Files are saved to the OpenClaw state directory. Use .md, .txt, .json, .yaml extensions.
      </p>
    </div>
  );
}
