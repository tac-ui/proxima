"use client";

import React, {useState} from "react";
import {usePathname} from "next/navigation";
import {SidebarNav} from "@/components/layout/Sidebar";
import {SidebarSearchIcon, SidebarSearchLabel} from "@/components/layout/SidebarHeader";
import {Header} from "@/components/layout/Header";
import {AuthGuard} from "@/components/auth/AuthGuard";
import {Sidebar} from "@tac-ui/web";
import {CommandPaletteProvider} from "@/components/shared/CommandPalette";

export default function DashboardLayout({children}: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isTerminal = pathname === "/terminal";
    const [collapsed, setCollapsed] = useState(false);

    return (
        <AuthGuard>
          <CommandPaletteProvider>
            <div className="h-full min-h-screen flex flex-col bg-[var(--background)]">
                <Header/>
                <div className="flex flex-1 overflow-hidden">
                    <Sidebar
                        collapsible
                        collapsed={collapsed}
                        onCollapse={setCollapsed}
                        icon={<SidebarSearchIcon />}
                        label={<SidebarSearchLabel />}
                        swapOnCollapse
                        width={240}
                        fillHeight
                        rounded
                        className="hidden md:flex shrink-0"
                    >
                        <SidebarNav />
                    </Sidebar>
                    <main className={isTerminal ? "flex-1 overflow-hidden p-3" : "flex-1 overflow-y-auto p-6"}>
                        {children}
                    </main>
                </div>
            </div>
          </CommandPaletteProvider>
        </AuthGuard>
    );
}
