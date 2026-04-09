"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useOpenClaw } from "@/contexts/OpenClawContext";
import { Button, Badge, EmptyState, Banner, pageEntrance, useToast } from "@tac-ui/web";
import { ArrowLeft, BrainCircuit, Trash2, WifiOff } from "@tac-ui/icon";
import { ChatMessage } from "@/components/openclaw/ChatMessage";
import { ChatInput } from "@/components/openclaw/ChatInput";
import { useConfirm } from "@/hooks/useConfirm";
import type { OpenClawMessage, OpenClawChatEvent } from "@/types";

export default function OpenClawChatPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { gateway, sessions } = useOpenClaw();
  const confirm = useConfirm();
  const sessionKey = decodeURIComponent(params.key as string);

  const [messages, setMessages] = useState<OpenClawMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");

  const session = sessions.find((s) => s.key === sessionKey);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Load chat history
  useEffect(() => {
    if (!gateway.connected) return;
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
          // Create new streaming message
          return [...prev, {
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
        // Replace stream message with final
        if (evt.message?.content) {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === `stream-${evt.runId}`);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                id: evt.runId,
                content: typeof evt.message!.content === "string" ? evt.message!.content : updated[idx].content,
              };
              return updated;
            }
            return prev;
          });
        }
        scrollToBottom();
      }

      if (evt.state === "error") {
        setStreaming(false);
        setCurrentRunId(null);
        streamingContentRef.current = "";
        toast(evt.errorMessage ?? "Chat error", { variant: "error" });
      }

      if (evt.state === "aborted") {
        setStreaming(false);
        setCurrentRunId(null);
        streamingContentRef.current = "";
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
              <Badge variant={gateway.connected ? "success" : "secondary"}>
                {gateway.connected ? "Connected" : "Disconnected"}
              </Badge>
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
          disabled={messages.length === 0 || streaming}
          leftIcon={<Trash2 size={14} />}
        >
          Clear
        </Button>
      </div>

      {/* Disconnect banner */}
      {!gateway.connected && (
        <div className="shrink-0 mb-2">
          <Banner variant="warning" icon={<WifiOff size={16} />} title="Gateway disconnected" description="Reconnecting automatically..." />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border bg-background/50 mb-3">
        <div className="max-w-screen-md mx-auto p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">Loading messages...</p>
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
