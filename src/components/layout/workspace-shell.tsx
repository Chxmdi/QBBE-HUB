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
    <div className="flex min-h-dvh">
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
          isStaff={isStaff}
          unreadCount={unreadCount}
          onOpenNav={() => setNavOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        isAdmin={isAdmin}
        isStaff={isStaff}
      />
    </div>
  );
}
