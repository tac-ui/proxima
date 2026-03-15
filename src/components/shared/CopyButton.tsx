"use client";

import React, { useState } from "react";
import { Button } from "@tac-ui/web";
import { Copy, Check } from "@tac-ui/icon";
import { useToast } from "@tac-ui/web";

interface CopyButtonProps {
  value: string;
  label?: string;
}

export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast(label ? `Copied ${label}` : "Copied to clipboard", { variant: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Failed to copy", { variant: "error" });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      onClick={handleCopy}
      className="h-6 w-6 shrink-0"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </Button>
  );
}
