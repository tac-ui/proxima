"use client";

import React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApiContext } from "@/contexts/ApiContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import {
  Header as TacHeader,
  Dropdown,
  DropdownItem,
  DropdownDivider,
  Button,
} from "@tac-ui/web";
import {
  LogOut,
  TacLogo,
} from "@tac-ui/icon";
import { Badge } from "@tac-ui/web";

function getPageTitle(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "Dashboard";

  const labelMap: Record<string, string> = {
    stacks: "Stacks",
    servers: "Servers",
    terminal: "Terminal",
    routes: "Routes",
    analytics: "Analytics",
    git: "Git Clone",
    projects: "Projects",
    settings: "Settings",
    users: "Users",
    account: "Account",
    cloudflare: "Cloudflare",
    "ssh-keys": "SSH Keys",
    "audit-logs": "Audit Logs",
    new: "New",
  };

  const lastSeg = segments[segments.length - 1];
  return labelMap[lastSeg] ?? lastSeg;
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { connected } = useApiContext();
  const { user, logout } = useAuth();
  const { appName, logoUrl, showLogo, showAppName } = useBranding();

  const pageTitle = getPageTitle(pathname);

  return (
    <TacHeader bordered>
      <div className="flex items-center justify-between w-full px-2 h-16">
        {/* Left: branding + icon + title + breadcrumb */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Branding */}
          {(showLogo || showAppName) && (
            <div className="flex items-center gap-2 shrink-0 cursor-pointer" onClick={() => router.push("/")}>
              {showLogo && (
                logoUrl ? (
                  <img src={logoUrl} alt={appName} className="w-7 h-7 rounded-md object-cover" />
                ) : (
                  <TacLogo size={28} />
                )
              )}
              {showAppName && (
                <span className="font-semibold text-sm tracking-wide">{appName}</span>
              )}
            </div>
          )}
          {(showLogo || showAppName) && (
            <div className="w-px h-6 bg-border shrink-0" />
          )}
          <h1 className="text-sm font-medium truncate min-w-0 text-muted-foreground">
            {pageTitle}
          </h1>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Connection indicator */}
          <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg bg-surface">
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-success animate-pulse" : "bg-error"}`}
            />
            <span className="text-muted-foreground hidden sm:inline">
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {/* User menu */}
          <Dropdown
            align="end"
            trigger={
              <Button variant="ghost" size="sm" className="rounded-lg px-3 py-2">
                <span className="text-sm">
                  {user?.username ?? ""}
                </span>
              </Button>
            }
          >
            <div
              className="px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors rounded-md"
              onClick={() => router.push("/account")}
            >
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-sm font-medium truncate">{user?.username}</p>
                {user?.role && (
                  <Badge variant={user.role === "admin" ? "default" : user.role === "manager" ? "success" : "secondary"}>
                    {user.role}
                  </Badge>
                )}
              </div>
            </div>
            <DropdownDivider />
            <DropdownItem destructive onClick={logout}>
              <LogOut size={14} />
              Sign Out
            </DropdownItem>
          </Dropdown>
        </div>
      </div>
    </TacHeader>
  );
}
