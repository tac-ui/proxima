"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import { Button, Badge, EmptyState, Banner, Skeleton, pageEntrance, useToast } from "@tac-ui/web";
import { ArrowLeft, BrainCircuit, Trash2, WifiOff, RefreshCw } from "@tac-ui/icon";
import { ChatMessage } from "@/components/openclaw/ChatMessage";
import { ChatInput } from "@/components/openclaw/ChatInput";
import { useConfirm } from "@/hooks/useConfirm";
import type { OpenClawMessage, OpenClawChatEvent } from "@/types";

// Module-scope per-session message cache so that navigating away from a
// chat and coming back doesn't clear the conversation (and doesn't flash
// the skeleton while refetching). We also skip the full history load if
// the cache is already populated for this session.
const chatMessageCache = new Map<string, OpenClawMessage[]>();

export default function OpenClawChatPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { gateway, sessions } = useOpenClaw();
  const confirm = useConfirm();
  const sessionKey = decodeURIComponent(params.key as string);

  const [messages, setMessages] = useState<OpenClawMessage[]>(
    () => chatMessageCache.get(sessionKey) ?? [],
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // Only show the skeleton on the very first load for this session —
  // subsequent remounts hydrate from the module cache immediately.
  const [loading, setLoading] = useState(!chatMessageCache.has(sessionKey));
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");

  // Keep the module cache in sync with the live state so the next mount
  // (tab switch / route navigation) shows the latest messages instantly.
  useEffect(() => {
    chatMessageCache.set(sessionKey, messages);
  }, [sessionKey, messages]);

  const session = sessions.find((s) => s.key === sessionKey);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load chat history
  useEffect(() => {
    if (!gateway.connected) { setLoading(false); return; }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const result = await gateway.request<{ messages?: OpenClawMessage[] }>("chat.history", {
          sessionKey,
          limit: 200,
        });
        if (!cancelled && result?.messages) {
          setMessages(
            result.messages.map((m) => ({
              id: m.id,
              role: m.role,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              timestamp: m.timestamp,
            }))
          );
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [gateway, sessionKey]);

  // Subscribe to chat events for streaming
  useEffect(() => {
    if (!gateway.connected) return;

    const unsub = gateway.subscribe("chat", (payload: unknown) => {
      const evt = payload as OpenClawChatEvent;
      if (evt.sessionKey !== sessionKey) return;

      if (evt.state === "delta" && evt.message?.content) {
        streamingContentRef.current += evt.message.content;
        setCurrentRunId(evt.runId);
        setStreaming(true);
        // Update the last assistant message with accumulated content
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id === `stream-${evt.runId}`) {
            return [...prev.slice(0, -1), { ...last, content: streamingContentRef.current }];
          }
          // Remove thinking placeholder and create streaming message
          return [...prev.filter(m => !m.id?.startsWith("thinking-")), {
            id: `stream-${evt.runId}`,
            role: "assistant" as const,
            content: streamingContentRef.current,
            timestamp: Date.now(),
          }];
        });
        scrollToBottom();
      }

      if (evt.state === "final") {
        setStreaming(false);
        setCurrentRunId(null);
        streamingContentRef.current = "";
        setMessages((prev) => {
          // Remove any thinking placeholders
          const cleaned = prev.filter(m => !m.id?.startsWith("thinking-"));
          const idx = cleaned.findIndex((m) => m.id === `stream-${evt.runId}`);
          const finalContent = typeof evt.message?.content === "string" ? evt.message.content : "";
          if (idx >= 0) {
            // Replace streaming message with final
            const updated = [...cleaned];
            updated[idx] = {
              ...updated[idx],
              id: evt.runId,
              content: finalContent || updated[idx].content,
            };
            return updated;
          }
          // No prior stream — append final message
          if (finalContent) {
            return [...cleaned, {
              id: evt.runId,
              role: "assistant" as const,
              content: finalContent,
              timestamp: Date.now(),
            }];
          }
          return cleaned;
        });
        scrollToBottom();
      }

      if (evt.state === "error") {
        setStreaming(false);
        setCurrentRunId(null);
        streamingContentRef.current = "";
        // Remove thinking and streaming placeholders
        setMessages((prev) => prev.filter(m =>
          !m.id?.startsWith("thinking-") && m.id !== `stream-${evt.runId}`
        ));
        toast(evt.errorMessage ?? "Chat error", { variant: "error" });
      }

      if (evt.state === "aborted") {
        setStreaming(false);
        setCurrentRunId(null);
        streamingContentRef.current = "";
        // Remove thinking and streaming placeholders
        setMessages((prev) => prev.filter(m =>
          !m.id?.startsWith("thinking-") && m.id !== `stream-${evt.runId}`
        ));
      }
    });

    return unsub;
  }, [gateway, sessionKey, scrollToBottom, toast]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom();
  }, [messages.length, scrollToBottom]);

  const handleSend = async () => {
    if (!input.trim() || streaming || !gateway.connected) return;

    const text = input.trim();
    setInput("");
    streamingContentRef.current = "";

    // Add user message + thinking placeholder immediately
    const userMsg: OpenClawMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    const thinkingMsg: OpenClawMessage = {
      id: `thinking-${Date.now()}`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setStreaming(true);
    scrollToBottom();

    try {
      await gateway.request("chat.send", {
        sessionKey,
        message: { role: "user", content: text },
      });
    } catch (err) {
      // Remove thinking placeholder on error
      setMessages((prev) => prev.filter(m => m.id !== thinkingMsg.id));
      setStreaming(false);
      toast(err instanceof Error ? err.message : "Failed to send message", { variant: "error" });
    }
  };

  const handleAbort = async () => {
    if (!currentRunId || !gateway.connected) return;
    try {
      await gateway.request("chat.abort", { sessionKey, runId: currentRunId });
    } catch { /* ignore */ }
  };

  const handleClearHistory = async () => {
    if (!gateway.connected) return;
    const ok = await confirm({
      title: "Clear Chat History",
      message: "Are you sure? All messages in this session will be permanently deleted.",
      confirmLabel: "Clear History",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await gateway.request("sessions.reset", { key: sessionKey });
      setMessages([]);
      toast("Chat history cleared", { variant: "success" });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear history", { variant: "error" });
    }
  };

  return (
    <motion.div className="h-full flex flex-col" {...pageEntrance}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/openclaw")}
            leftIcon={<ArrowLeft size={14} />}
          >
            Back
          </Button>
          <div className="w-9 h-9 rounded-xl bg-point/15 flex items-center justify-center">
            <BrainCircuit size={18} className="text-point" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{session?.label || sessionKey}</h2>
              {(() => {
                // Mirror the main page header's tri-state resolver so the
                // user sees the same status everywhere (Connected /
                // Reconnecting / Disconnected).
                const label = gateway.reconnecting
                  ? "Reconnecting"
                  : gateway.connected
                    ? "Connected"
                    : "Disconnected";
                const variant = gateway.reconnecting
                  ? "warning"
                  : gateway.connected
                    ? "success"
                    : "secondary";
                const dotClass = gateway.reconnecting
                  ? "bg-warning animate-pulse"
                  : gateway.connected
                    ? "bg-success"
                    : "bg-muted-foreground/50";
                return (
                  <Badge variant={variant}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
                      {label}
                    </span>
                  </Badge>
                );
              })()}
            </div>
            {session?.modelRef && (
              <p className="text-xs text-muted-foreground">{session.modelRef}</p>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearHistory}
          disabled={messages.length === 0 || streaming || !gateway.connected}
          leftIcon={<Trash2 size={14} />}
        >
          Clear
        </Button>
      </div>

      {/* Disconnect / reconnecting banner */}
      {!gateway.connected && (
        <div className="shrink-0 mb-2">
          <Banner
            variant="warning"
            icon={gateway.reconnecting ? <RefreshCw size={16} className="animate-spin" /> : <WifiOff size={16} />}
            title={gateway.reconnecting ? "Reconnecting to gateway…" : "Gateway disconnected"}
            description={gateway.reconnecting
              ? "Hold tight — the connection will restore automatically."
              : "Waiting for connection. Sessions and chat are read-only."}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background/50 mb-3">
        <div className="max-w-screen-md mx-auto p-4 space-y-4">
          {loading ? (
            <div className="space-y-4 py-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`flex gap-3 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
                  <Skeleton variant="rectangular" width={32} height={32} className="rounded-lg shrink-0" />
                  <div className={`flex-1 ${i % 2 === 0 ? "" : "flex justify-end"}`}>
                    <Skeleton height={64} width={`${60 + (i * 5)}%`} className="rounded-2xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="py-8">
              <EmptyState
                icon={<BrainCircuit size={32} />}
                title="Start a conversation"
                description="Type a message below to begin"
              />
            </div>
          ) : (
            messages.map((msg, i) => (
              <ChatMessage
                key={msg.id ?? i}
                message={msg}
                isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 max-w-screen-md mx-auto w-full">
        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          onAbort={handleAbort}
          streaming={streaming}
          disabled={!gateway.connected}
        />
      </div>
    </motion.div>
  );
}
