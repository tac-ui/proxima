"use client";

import React from "react";
import { Search } from "@tac-ui/icon";
import { useCommandPalette } from "@/components/shared/CommandPalette";

/** Icon shown when sidebar is collapsed (swapOnCollapse) */
export function SidebarSearchIcon() {
  const { open: openSearch } = useCommandPalette();

  return (
    <button
      onClick={openSearch}
      className="w-8 h-8 rounded-[var(--radius-m)] flex items-center justify-center hover:bg-[var(--point-subtle)] transition-colors text-[var(--muted-foreground)] cursor-pointer"
      title="Search (⌘K)"
    >
      <Search size={16} />
    </button>
  );
}

/** Label shown when sidebar is expanded (swapOnCollapse) */
export function SidebarSearchLabel() {
  const { open: openSearch } = useCommandPalette();

  return (
    <button
      onClick={openSearch}
      className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[var(--radius-m)] border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--point-subtle)] transition-colors text-[var(--muted-foreground)] cursor-pointer"
      title="Search (⌘K)"
    >
      <Search size={14} className="shrink-0" />
      <span className="text-xs flex-1 text-left">Search...</span>
      <kbd className="inline-flex h-[18px] items-center rounded border border-[var(--border)] bg-[var(--muted)] px-1 text-[10px] font-medium text-[var(--muted-foreground)]">
        ⌘K
      </kbd>
    </button>
  );
}