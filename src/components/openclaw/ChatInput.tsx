"use client";

import React, { useRef, useEffect } from "react";
import { Button } from "@tac-ui/web";
import { Send, Square } from "@tac-ui/icon";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onAbort?: () => void;
  streaming?: boolean;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, onAbort, streaming, disabled }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming && value.trim()) {
        onSend();
      }
    }
  };

  return (
    <div className={`border rounded-2xl overflow-hidden transition-shadow ${disabled ? "border-border opacity-60" : "border-border focus-within:ring-1 focus-within:ring-ring"}`}>
      {disabled && (
        <div className="px-4 pt-2">
          <p className="text-[10px] text-warning">Gateway disconnected. Waiting for reconnection...</p>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Waiting for connection..." : "Type a message..."}
        disabled={disabled}
        rows={1}
        aria-label="Chat message input"
        className="w-full px-4 pt-3 pb-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground outline-none resize-none"
      />
      <div className="flex items-center justify-end gap-2 px-3 pb-2">
        <span className="text-[10px] text-muted-foreground mr-auto">Shift+Enter for new line</span>
        {streaming ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onAbort}
            leftIcon={<Square size={14} />}
            aria-label="Stop generating response"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={!value.trim() || disabled}
            onClick={onSend}
            leftIcon={<Send size={14} />}
            aria-label="Send message"
          >
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
