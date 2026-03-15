"use client";

import React, { useRef, useState } from "react";

interface ComposeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  rows?: number;
}

export function ComposeEditor({
  value,
  onChange,
  placeholder = "version: '3.8'\nservices:\n  app:\n    image: nginx:latest\n    ports:\n      - '80:80'",
  label,
  rows = 20,
}: ComposeEditorProps) {
  const [lineCount, setLineCount] = useState(value.split("\n").length || 1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setLineCount(newValue.split("\n").length || 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.substring(0, start) + "  " + value.substring(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        if (ta) {
          ta.selectionStart = ta.selectionEnd = start + 2;
        }
      });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-sm font-medium">{label}</label>}
      <div className="flex rounded-lg border border-border overflow-hidden bg-background focus-within:ring-2 focus-within:ring-point focus-within:border-transparent transition-all">
        {/* Line numbers */}
        <div
          className="select-none text-right text-xs text-muted-foreground/50 bg-surface border-r border-border px-2 pt-3"
          style={{ fontFamily: "ui-monospace, monospace", lineHeight: "1.625rem", minWidth: "3rem" }}
          aria-hidden="true"
        >
          {Array.from({ length: Math.max(lineCount, 1) }, (_, i) => (
            <div key={i + 1}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={rows}
          spellCheck={false}
          className="flex-1 px-4 py-3 text-xs bg-transparent resize-none placeholder-muted-foreground/40 focus:outline-none"
          style={{ fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace", lineHeight: "1.625rem" }}
        />
      </div>
    </div>
  );
}
