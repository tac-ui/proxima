"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SidebarGroup, SidebarItem } from "@tac-ui/web";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Layers,
  Globe,
  Settings,
  Server,
  Boxes,
  Network,
  Cog,
  BarChart3,
  FolderGit2,
  SquareTerminal,
  Users,
  UserCircle,
  Cloud,
  KeyRound,
  ScrollText,
} from "@tac-ui/icon";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

interface NavGroupDef {
  key: string;
  label: string;
  icon: React.ReactNode;
  items: NavItem[];
}

const dashboardItem: NavItem = {
  href: "/",
  label: "Dashboard",
  icon: <LayoutDashboard size={20} />,
};

const terminalItem: NavItem = {
  href: "/terminal",
  label: "Terminal",
  icon: <SquareTerminal size={20} />,
};

const navGroups: NavGroupDef[] = [
  {
    key: "services",
    label: "Services",
    icon: <Boxes size={16} />,
    items: [
      { href: "/stacks", label: "Stacks", icon: <Layers size={20} /> },
      { href: "/servers", label: "Servers", icon: <Server size={20} /> },
    ],
  },
  {
    key: "projects",
    label: "Projects",
    icon: <FolderGit2 size={16} />,
    items: [
      { href: "/projects", label: "Projects", icon: <FolderGit2 size={20} /> },
    ],
  },
  {
    key: "network",
    label: "Network",
    icon: <Network size={16} />,
    items: [
      { href: "/routes", label: "Routes", icon: <Globe size={20} /> },
      { href: "/analytics", label: "Analytics", icon: <BarChart3 size={20} /> },
    ],
  },
  {
    key: "system",
    label: "System",
    icon: <Cog size={16} />,
    items: [
      { href: "/users", label: "Users", icon: <Users size={20} /> },
      { href: "/account", label: "Account", icon: <UserCircle size={20} /> },
      { href: "/cloudflare", label: "Cloudflare", icon: <Cloud size={20} /> },
      { href: "/ssh-keys", label: "SSH Keys", icon: <KeyRound size={20} /> },
      { href: "/audit-logs", label: "Audit Logs", icon: <ScrollText size={20} />, adminOnly: true },
      { href: "/settings", label: "Settings", icon: <Settings size={20} /> },
    ],
  },
];

function useActiveGroup(pathname: string) {
  return useMemo(() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (pathname === item.href || pathname.startsWith(item.href + "/")) {
          return group.key;
        }
      }
    }
    return "";
  }, [pathname]);
}

export function SidebarNav() {
  const pathname = usePathname();
  const activeGroup = useActiveGroup(pathname);
  const { isAdmin } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Dashboard & Terminal - standalone */}
      <SidebarGroup>
        <Link href={dashboardItem.href}>
          <SidebarItem icon={dashboardItem.icon} active={isActive(dashboardItem.href)} variant={'subtle'}>
            {dashboardItem.label}
          </SidebarItem>
        </Link>
        <Link href={terminalItem.href}>
          <SidebarItem icon={terminalItem.icon} active={isActive(terminalItem.href)} variant={'subtle'}>
            {terminalItem.label}
          </SidebarItem>
        </Link>
      </SidebarGroup>

      <div className="mx-3 my-1 border-t border-border" />

      {/* Grouped navigation */}
      {navGroups.map((group) => {
        const visibleItems = group.items.filter((item) => !item.adminOnly || isAdmin);
        if (visibleItems.length === 0) return null;
        const isGroupActive = group.key === activeGroup;
        return (
          <SidebarGroup
            key={group.key}
            label={group.label}
            icon={group.icon}
            active={isGroupActive}
            collapseDisplay="group"
            collapsible
            defaultOpen={isGroupActive}
          >
            {visibleItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <SidebarItem icon={item.icon} active={isActive(item.href)}>
                  {item.label}
                </SidebarItem>
              </Link>
            ))}
          </SidebarGroup>
        );
      })}
    </>
  );
}
