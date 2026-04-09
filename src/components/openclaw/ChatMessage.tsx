"use client";

import React from "react";
import { Bot, User } from "@tac-ui/icon";
import type { OpenClawMessage } from "@/types";

interface ChatMessageProps {
  message: OpenClawMessage;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`} role="article" aria-label={`${isUser ? "You" : "AI"}: ${message.content.slice(0, 50)}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isUser ? "bg-point/15" : "bg-muted"}`}>
        {isUser ? <User size={16} className="text-point" /> : <Bot size={16} className="text-muted-foreground" />}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        <div
          className={`inline-block max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-point text-white rounded-tr-md"
              : "bg-muted text-foreground rounded-tl-md"
          }`}
        >
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
          {isStreaming && (
            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground" aria-live="polite">
              <span className="inline-flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1 h-1 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
              <span>Generating...</span>
            </div>
          )}
        </div>
        {message.timestamp && (
          <p className="text-[10px] text-muted-foreground mt-1 px-1">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        )}
      </div>
    </div>
  );
}
