"use client";

import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog } from "@tac-ui/web";
import {
  LayoutDashboard,
  Layers,
  Globe,
  FolderGit2,
  Settings,
  Server,
  BarChart3,
  Search,
  SquareTerminal,
  Cloud,
  KeyRound,
  Users,
  UserCircle,
  ScrollText,
} from "@tac-ui/icon";

interface CommandItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  keywords?: string[];
}

interface CommandGroup {
  key: string;
  label: string;
  items: CommandItem[];
}

const commandGroups: CommandGroup[] = [
  {
    key: "general",
    label: "General",
    items: [
      { id: "dashboard", label: "Dashboard", href: "/", icon: <LayoutDashboard size={16} />, keywords: ["home", "overview"] },
      { id: "terminal", label: "Terminal", href: "/terminal", icon: <SquareTerminal size={16} />, keywords: ["shell", "bash", "console", "cli"] },
    ],
  },
  {
    key: "services",
    label: "Services",
    items: [
      { id: "stacks", label: "Stacks", href: "/stacks", icon: <Layers size={16} />, keywords: ["docker", "compose", "container"] },
      { id: "servers", label: "Servers", href: "/servers", icon: <Server size={16} />, keywords: ["machine", "host", "process"] },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    items: [
      { id: "projects", label: "Projects", href: "/projects", icon: <FolderGit2 size={16} />, keywords: ["git", "repository", "clone", "deploy"] },
    ],
  },
  {
    key: "network",
    label: "Network",
    items: [
      { id: "routes", label: "Routes", href: "/routes", icon: <Globe size={16} />, keywords: ["domain", "reverse proxy", "tunnel", "route"] },
      { id: "analytics", label: "Analytics", href: "/analytics", icon: <BarChart3 size={16} />, keywords: ["stats", "traffic", "metrics"] },
    ],
  },
  {
    key: "system",
    label: "System",
    items: [
      { id: "users", label: "Users", href: "/users", icon: <Users size={16} />, keywords: ["admin", "role", "manage"] },
      { id: "account", label: "Account", href: "/account", icon: <UserCircle size={16} />, keywords: ["profile", "password"] },
      { id: "cloudflare", label: "Cloudflare", href: "/cloudflare", icon: <Cloud size={16} />, keywords: ["tunnel", "dns", "cdn"] },
      { id: "ssh-keys", label: "SSH Keys", href: "/ssh-keys", icon: <KeyRound size={16} />, keywords: ["git", "key", "deploy"] },
      { id: "audit-logs", label: "Audit Logs", href: "/audit-logs", icon: <ScrollText size={16} />, keywords: ["audit", "log", "activity"] },
      { id: "settings", label: "Settings", href: "/settings", icon: <Settings size={16} />, keywords: ["config", "preference", "branding", "theme"] },
    ],
  },
];

/* ─── Context ─── */
interface CommandPaletteContextValue {
  open: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({ open: () => {} });

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

/* ─── Dialog ─── */
function CommandDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const router = useRouter();

  const onSelect = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [router, onClose],
  );

  return (
    <Dialog open={isOpen} onClose={onClose}>
      <div className="w-[560px] max-w-[90vw]">
        <Command label="Search pages" className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 border-b border-border">
            <Search size={16} className="shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              placeholder="Search pages..."
              className="w-full h-12 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
              ESC
            </kbd>
          </div>
          <Command.List className="max-h-[320px] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>
            {commandGroups.map((group) => (
              <Command.Group
                key={group.key}
                heading={group.label}
                className="[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1"
              >
                {group.items.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${group.label} ${item.label} ${item.keywords?.join(" ") ?? ""}`}
                    onSelect={() => onSelect(item.href)}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg cursor-pointer text-muted-foreground data-[selected=true]:bg-point/10 data-[selected=true]:text-foreground transition-colors"
                  >
                    <span className="shrink-0 text-muted-foreground">{item.icon}</span>
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </Dialog>
  );
}

/* ─── Provider (wraps children so useCommandPalette works anywhere inside) ─── */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      <CommandDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </CommandPaletteContext.Provider>
  );
}

/** @deprecated Use CommandPaletteProvider instead */
export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return <CommandDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}
