"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Input, Skeleton, useToast } from "@tac-ui/web";
import {
  Plus,
  Trash2,
  FileText,
  FileJson,
  FileCode,
  File as FileIcon,
  Save,
  X,
  ChevronDown,
  Archive,
  Sparkles,
} from "@tac-ui/icon";
import { api } from "@/lib/api";
import { useConfirm } from "@/hooks/useConfirm";

interface FileEntry { name: string; size: number; }

// `.bak`, `.bak.1`, `.bak.N` — OpenClaw rotates config backups. These can
// be deleted from the UI but not opened/edited (strict extension check).
function isBackupFile(name: string): boolean {
  return /\.bak(\.\d+)?$/i.test(name);
}

/** Canonical harness filenames recognized by OpenClaw's agent runtime. */
const HARNESS_PRESETS: Array<{ name: string; description: string }> = [
  { name: "USER.md", description: "Personal context & preferences for the assistant" },
  { name: "CLAUDE.md", description: "Project-level instructions for Claude" },
  { name: "SOUL.md", description: "Agent persona / soul definition — tone, values, personality" },
];

/** Files that OpenClaw manages automatically — users rarely edit these. */
const SYSTEM_FILE_DESCRIPTIONS: Record<string, string> = {
  "update-check.json": "OpenClaw update-checker state (managed automatically)",
  "auth-profiles.json": "Custom token providers (edit via Credentials → Token Providers)",
  "auth-state.json": "OAuth session state",
};

function isSystemFile(name: string): boolean {
  return name in SYSTEM_FILE_DESCRIPTIONS;
}

function fileDescription(name: string): string | undefined {
  const preset = HARNESS_PRESETS.find(p => p.name === name);
  if (preset) return preset.description;
  return SYSTEM_FILE_DESCRIPTIONS[name];
}

/** Map a file extension to a themed icon. */
function fileIcon(name: string): React.ReactElement {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "md") return <FileText size={14} className="text-info shrink-0" />;
  if (ext === "json") return <FileJson size={14} className="text-warning shrink-0" />;
  if (ext === "yaml" || ext === "yml" || ext === "toml") return <FileCode size={14} className="text-success shrink-0" />;
  if (ext === "txt") return <FileText size={14} className="text-muted-foreground shrink-0" />;
  return <FileIcon size={14} className="text-muted-foreground shrink-0" />;
}

/** Human-readable byte count. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Editor view — extracted so we can attach keyboard shortcuts cleanly
// ---------------------------------------------------------------------------

interface EditorViewProps {
  filename: string;
  initialContent: string;
  saving: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: (dirty: boolean) => void;
}

function EditorView({ filename, initialContent, saving, onSave, onClose }: EditorViewProps) {
  const [content, setContent] = useState(initialContent);
  const dirty = content !== initialContent;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ctrl/Cmd+S to save, Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (!saving && dirty) onSave(content);
      }
      if (e.key === "Escape") {
        onClose(dirty);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content, dirty, saving, onSave, onClose]);

  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const charCount = content.length;

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="space-y-3"
    >
      {/* Sticky header */}
      <div className="flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur-sm py-1 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {fileIcon(filename)}
          <p className="text-sm font-medium truncate">
            {dirty && <span className="text-warning mr-1" title="Unsaved changes">•</span>}
            {filename}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={() => onClose(dirty)} leftIcon={<X size={14} />}>
            Close
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saving || !dirty}
            onClick={() => onSave(content)}
            leftIcon={<Save size={14} />}
            title="Save (Ctrl/Cmd+S)"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={16}
        spellCheck={false}
        placeholder="# Start writing your harness file..."
        className="w-full px-4 py-3 text-xs font-mono rounded-lg border border-border bg-muted text-foreground outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring resize-y leading-relaxed transition-shadow"
      />

      {/* Editor footer with metadata */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
          <span>·</span>
          <span>{formatSize(charCount)}</span>
        </div>
        <div className="flex items-center gap-1">
          <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px]">⌘S</kbd>
          <span>to save</span>
          <span className="mx-1">·</span>
          <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px]">Esc</kbd>
          <span>to close</span>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// FileManager — list + editor
// ---------------------------------------------------------------------------

export function FileManager() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ name: string; content: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showBackups, setShowBackups] = useState(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const res = await api.getOpenClawFiles();
    if (res.ok && res.data) setFiles(res.data);
    setLoading(false);
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const { editableFiles, backupFiles, harnessFiles, systemFiles, otherFiles } = useMemo(() => {
    const editable: FileEntry[] = [];
    const backups: FileEntry[] = [];
    for (const f of files) {
      if (isBackupFile(f.name)) backups.push(f);
      else editable.push(f);
    }
    const harnessNames = new Set(HARNESS_PRESETS.map(p => p.name));
    const harness = editable.filter(f => harnessNames.has(f.name));
    const system = editable.filter(f => !harnessNames.has(f.name) && isSystemFile(f.name));
    const others = editable.filter(f => !harnessNames.has(f.name) && !isSystemFile(f.name));
    return {
      editableFiles: editable,
      backupFiles: backups,
      harnessFiles: harness,
      systemFiles: system,
      otherFiles: others,
    };
  }, [files]);

  const missingHarnessPresets = HARNESS_PRESETS.filter(
    p => !files.some(f => f.name === p.name),
  );

  const handleOpen = async (name: string) => {
    const res = await api.readOpenClawFile(name);
    if (res.ok && res.data) {
      setEditing({ name, content: res.data.content });
    } else {
      toast(res.error ?? "Failed to read file", { variant: "error" });
    }
  };

  const handleSave = async (content: string) => {
    if (!editing) return;
    setSaving(true);
    const res = await api.writeOpenClawFile(editing.name, content);
    if (res.ok) {
      toast("File saved", { variant: "success" });
      // Update the editor's baseline so dirty flag resets without reopening.
      setEditing({ name: editing.name, content });
      loadFiles();
    } else {
      toast(res.error ?? "Failed to save", { variant: "error" });
    }
    setSaving(false);
  };

  const handleCloseEditor = async (dirty: boolean) => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved changes?",
        message: `${editing?.name} has unsaved edits. Closing will discard them.`,
        confirmLabel: "Discard",
        variant: "destructive",
      });
      if (!ok) return;
    }
    setEditing(null);
  };

  const handleCreate = async (name: string) => {
    const target = name.trim();
    if (!target) return;
    setSaving(true);
    const res = await api.writeOpenClawFile(target, "");
    if (res.ok) {
      toast(`Created ${target}`, { variant: "success" });
      setCreating(false);
      setNewName("");
      await loadFiles();
      // Immediately open it so the user can start writing.
      const openRes = await api.readOpenClawFile(target);
      if (openRes.ok && openRes.data) {
        setEditing({ name: target, content: openRes.data.content });
      }
    } else {
      toast(res.error ?? "Failed to create", { variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async (name: string) => {
    const ok = await confirm({
      title: "Delete file?",
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    const res = await api.deleteOpenClawFile(name);
    if (res.ok) {
      toast("File deleted", { variant: "success" });
      if (editing?.name === name) setEditing(null);
      loadFiles();
    } else {
      toast(res.error ?? "Failed to delete", { variant: "error" });
    }
  };

  // -----------------------------------------------------------------------
  // Editor mode
  // -----------------------------------------------------------------------
  if (editing) {
    return (
      <AnimatePresence mode="wait">
        <EditorView
          key={editing.name}
          filename={editing.name}
          initialContent={editing.content}
          saving={saving}
          onSave={handleSave}
          onClose={handleCloseEditor}
        />
      </AnimatePresence>
    );
  }

  // -----------------------------------------------------------------------
  // List mode
  // -----------------------------------------------------------------------
  const showEmptyState = !loading && editableFiles.length === 0 && !creating;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-muted-foreground" />
          <p className="text-sm font-medium">Harness Files</p>
          {editableFiles.length > 0 && (
            <span className="text-[10px] text-muted-foreground">({editableFiles.length})</span>
          )}
        </div>
        {!creating && (
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)} leftIcon={<Plus size={14} />}>
            New File
          </Button>
        )}
      </div>

      {/* Inline create row */}
      <AnimatePresence initial={false}>
        {creating && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-2">
              <Plus size={14} className="text-muted-foreground shrink-0 ml-1" />
              <Input
                value={newName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === "Enter" && newName.trim()) handleCreate(newName);
                  if (e.key === "Escape") { setCreating(false); setNewName(""); }
                }}
                placeholder="e.g. USER.md, notes.txt"
                size="sm"
                autoFocus
              />
              <Button
                variant="primary"
                size="sm"
                disabled={!newName.trim() || saving}
                onClick={() => handleCreate(newName)}
              >
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setNewName(""); }}>
                Cancel
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg border border-border">
              <Skeleton variant="circular" width={14} height={14} />
              <Skeleton width={160} height={12} />
              <div className="ml-auto">
                <Skeleton width={48} height={10} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state with preset quick-create */}
      {showEmptyState && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="rounded-lg border border-dashed border-border px-4 py-5 space-y-3"
        >
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-point shrink-0 mt-0.5" />
            <div className="flex-1 space-y-0.5">
              <p className="text-xs font-medium">No harness files yet</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                OpenClaw reads these Markdown files as context for the agent. Start with one of the canonical presets below.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {HARNESS_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="group flex-1 min-w-[160px] rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-point/40 hover:bg-point/5 transition-colors"
                onClick={() => handleCreate(p.name)}
              >
                <div className="flex items-center gap-1.5">
                  {fileIcon(p.name)}
                  <span className="text-xs font-mono font-medium">{p.name}</span>
                  <Plus size={12} className="ml-auto text-muted-foreground group-hover:text-point transition-colors" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-snug">{p.description}</p>
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Harness file section (USER.md / CLAUDE.md / SOUL.md) */}
      {!loading && harnessFiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">Harness</p>
          <AnimatePresence initial={false}>
            {harnessFiles.map((f) => (
              <FileRow
                key={f.name}
                file={f}
                onOpen={() => handleOpen(f.name)}
                onDelete={() => handleDelete(f.name)}
                description={fileDescription(f.name)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Missing harness presets: offer to create */}
      {!loading && harnessFiles.length > 0 && missingHarnessPresets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {missingHarnessPresets.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => handleCreate(p.name)}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              title={p.description}
            >
              <Plus size={10} />
              Create {p.name}
            </button>
          ))}
        </div>
      )}

      {/* System files — managed automatically */}
      {!loading && systemFiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">System (managed)</p>
          <AnimatePresence initial={false}>
            {systemFiles.map((f) => (
              <FileRow
                key={f.name}
                file={f}
                onOpen={() => handleOpen(f.name)}
                onDelete={() => handleDelete(f.name)}
                description={fileDescription(f.name)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Other files */}
      {!loading && otherFiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-1">Other</p>
          <AnimatePresence initial={false}>
            {otherFiles.map((f) => (
              <FileRow
                key={f.name}
                file={f}
                onOpen={() => handleOpen(f.name)}
                onDelete={() => handleDelete(f.name)}
                description={fileDescription(f.name)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Backup files — collapsible, hidden by default */}
      {!loading && backupFiles.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setShowBackups(v => !v)}
            className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/30 transition-colors"
          >
            <Archive size={12} className="text-muted-foreground" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Backups ({backupFiles.length})
            </span>
            <motion.span
              animate={{ rotate: showBackups ? 180 : 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="ml-auto text-muted-foreground"
            >
              <ChevronDown size={12} />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {showBackups && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="overflow-hidden"
              >
                <div className="px-2 pb-2 pt-1 space-y-1 border-t border-border">
                  {backupFiles.map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center gap-2 p-1.5 rounded opacity-70 group"
                      title="Backup file — read-only"
                    >
                      <FileIcon size={12} className="text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono truncate flex-1">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(f.size)}</span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-error transition-colors sm:opacity-0 sm:group-hover:opacity-100 p-0.5"
                        onClick={() => handleDelete(f.name)}
                        aria-label={`Delete ${f.name}`}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Files are saved to the OpenClaw state directory. Allowed extensions: .md, .txt, .json, .yaml, .yml, .toml.
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// FileRow — single list item (animated)
// ---------------------------------------------------------------------------

interface FileRowProps {
  file: FileEntry;
  onOpen: () => void;
  onDelete: () => void;
  description?: string;
}

function FileRow({ file, onOpen, onDelete, description }: FileRowProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="flex items-center gap-2 p-2 rounded-lg border border-border hover:border-foreground/30 hover:bg-muted/30 transition-colors group"
      title={description}
    >
      <button
        type="button"
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
        onClick={onOpen}
      >
        {fileIcon(file.name)}
        <div className="min-w-0 flex-1">
          <span className="text-xs font-mono truncate block">{file.name}</span>
          {description && (
            <span className="text-[9px] text-muted-foreground truncate block leading-tight">
              {description}
            </span>
          )}
        </div>
      </button>
      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{formatSize(file.size)}</span>
      <button
        type="button"
        className="text-muted-foreground hover:text-error transition-colors sm:opacity-0 sm:group-hover:opacity-100 p-1 rounded"
        onClick={onDelete}
        aria-label={`Delete ${file.name}`}
      >
        <Trash2 size={12} />
      </button>
    </motion.div>
  );
}
