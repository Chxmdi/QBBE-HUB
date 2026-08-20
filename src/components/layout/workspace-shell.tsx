"use client";

import { useEffect, useState } from "react";
import {
  Sidebar,
  type SidebarChannel,
  type SidebarCounts,
  type SidebarProgram,
} from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Persistent application shell (P0-UX-01): sidebar, topbar, command
 * palette, quick create, notifications, theme control.
 */
export function WorkspaceShell({
  name,
  title,
  avatarUrl,
  isAdmin,
  isStaff,
  unreadCount,
  channels,
  programs,
  counts,
  density = "comfortable",
  children,
}: {
  name: string;
  title: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  isStaff: boolean;
  unreadCount: number;
  channels: SidebarChannel[];
  programs: SidebarProgram[];
  counts: SidebarCounts;
  density?: "comfortable" | "compact";
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ToastProvider>
    <div className="flex min-h-dvh" data-density={density}>
      <Sidebar
        isAdmin={isAdmin}
        isStaff={isStaff}
        channels={channels}
        programs={programs}
        counts={counts}
        userName={name}
        userTitle={title}
        userAvatarUrl={avatarUrl}
        mobileOpen={navOpen}
        onMobileClose={() => setNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          name={name}
          avatarUrl={avatarUrl}
          isAdmin={isAdmin}
          isStaff={isStaff}
          unreadCount={unreadCount}
          density={density}
          onOpenNav={() => setNavOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        {/* pb-20 on mobile clears the fixed bottom navigation. */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pt-6 pb-24 md:px-8 md:pb-6">
          {children}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isAdmin={isAdmin}
        isStaff={isStaff}
      />
      <MobileNav
        isAdmin={isAdmin}
        isStaff={isStaff}
        myWorkCount={counts.myWork}
        onOpenMore={() => setNavOpen(true)}
      />
    </div>
    </ToastProvider>
  );
}
