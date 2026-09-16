"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Plus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { QbbeLogo } from "@/components/layout/qbbe-logo";
import { cn } from "@/lib/utils";
import { visibleNav } from "@/config/navigation";

export interface SidebarChannel {
  id: string;
  slug: string;
  unread: boolean;
}

export interface SidebarProgram {
  id: string;
  name: string;
}

export interface SidebarCounts {
  myWork: number;
  inbox: number;
}

const PROGRAM_DOT_COLORS = [
  "#E8B36D",
  "#7185D2",
  "#56A57A",
  "#8E72BE",
  "#D9834E",
  "#D65F78",
];

function programDot(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return PROGRAM_DOT_COLORS[hash % PROGRAM_DOT_COLORS.length];
}

/**
 * QBBE navigation shell using the approved blue/gold brand while preserving
 * permission-aware navigation, live counts, channels, and program shortcuts.
 */
export function Sidebar({
  isAdmin,
  isStaff,
  channels,
  programs,
  counts,
  userName,
  userTitle,
  userAvatarUrl,
  mobileOpen,
  onMobileClose,
}: {
  isAdmin: boolean;
  isStaff: boolean;
  channels: SidebarChannel[];
  programs: SidebarProgram[];
  counts: SidebarCounts;
  userName: string;
  userTitle: string | null;
  userAvatarUrl: string | null;
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const pathname = usePathname();
  const groups = visibleNav({ isAdmin, isStaff });

  const badgeFor = (href: string): number =>
    href === "/my-work" ? counts.myWork : href === "/inbox" ? counts.inbox : 0;

  const nav = (
    <nav aria-label="Main navigation" className="relative flex h-full flex-col overflow-hidden">
      <div className="relative px-4 pt-4 pb-3">
        <div className="flex items-start gap-2">
          <Link href="/" onClick={onMobileClose} aria-label="QBBE Hub home" className="min-w-0 flex-1">
            <QbbeLogo />
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close navigation"
            className="mt-0.5 rounded-(--radius-sm) p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="qbbe-brand-rule mt-3" aria-hidden />
        <p className="mt-2 text-[10.5px] font-semibold tracking-[0.08em] text-white/68">
          Internal operations workspace
        </p>
      </div>

      <div className="relative flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        {groups.map((group, groupIndex) => (
          <div key={group.label}>
            <p
              className={cn(
                "px-2 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] uppercase",
                groupIndex % 3 === 0
                  ? "text-[#F3C88E]"
                  : groupIndex % 3 === 1
                    ? "text-[#C9D2FF]"
                    : "text-white/72",
              )}
            >
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                const badge = badgeFor(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-(--radius-sm) border px-2.5 py-[7px] text-[13.5px] font-semibold",
                        "transition-colors duration-(--duration-fast)",
                        active
                          ? "border-accent/25 bg-white/12 text-white shadow-(--shadow-raise)"
                          : "border-transparent text-white/78 hover:border-white/8 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <item.icon
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-accent" : "text-white/72",
                        )}
                        aria-hidden
                      />
                      {item.label}
                      {badge > 0 ? (
                        <span
                          className={cn(
                            "ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] leading-none font-bold",
                            active
                              ? "bg-accent text-[#253460]"
                              : "bg-accent/95 text-[#253460]",
                          )}
                        >
                          {badge > 99 ? "99+" : badge}
                          <span className="sr-only"> open items</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {channels.length > 0 ? (
          <div>
            <p className="px-2 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-[#C9D2FF] uppercase">
              Channels
            </p>
            <ul className="space-y-0.5">
              {channels.map((channel) => {
                const href = `/channels/${channel.id}`;
                const active = pathname === href;
                return (
                  <li key={channel.id}>
                    <Link
                      href={href}
                      onClick={onMobileClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-(--radius-sm) border px-2.5 py-[6px] text-[13.5px]",
                        "transition-colors duration-(--duration-fast)",
                        active
                          ? "border-accent/25 bg-white/12 font-semibold text-white"
                          : channel.unread
                            ? "border-transparent font-semibold text-white hover:bg-white/8"
                            : "border-transparent text-white/75 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <span aria-hidden className={active ? "text-accent" : "text-white/60"}>
                        #
                      </span>
                      <span className="truncate">{channel.slug}</span>
                      {channel.unread ? (
                        <>
                          <span className="sr-only">Unread messages</span>
                          <span
                            aria-hidden
                            className="ml-auto size-1.5 rounded-full bg-accent shadow-[0_0_0_2px_rgb(255_255_255_/_0.08)]"
                          />
                        </>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {isStaff && programs.length > 0 ? (
          <div>
            <p className="flex items-center justify-between px-2 pb-1.5 text-[10.5px] font-bold tracking-[0.12em] text-[#F3C88E] uppercase">
              Programs
              <Link
                href="/programs"
                onClick={onMobileClose}
                aria-label="Add or manage programs"
                className="rounded p-0.5 text-white/65 transition-colors hover:bg-white/8 hover:text-white"
              >
                <Plus className="size-3.5" aria-hidden />
              </Link>
            </p>
            <ul className="space-y-0.5">
              {programs.slice(0, 6).map((program) => {
                const href = `/programs/${program.id}`;
                const active = pathname === href;
                return (
                  <li key={program.id}>
                    <Link
                      href={href}
                      onClick={onMobileClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-(--radius-sm) border px-2.5 py-[6px] text-[13.5px]",
                        active
                          ? "border-accent/25 bg-white/12 font-semibold text-white"
                          : "border-transparent text-white/75 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full shadow-[0_0_0_2px_rgb(255_255_255_/_0.10)]"
                        style={{ background: programDot(program.name) }}
                      />
                      <span className="truncate">{program.name}</span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  href="/programs"
                  onClick={onMobileClose}
                  className="block rounded-(--radius-sm) px-2.5 py-[6px] text-[12.5px] font-medium text-white/55 hover:bg-white/8 hover:text-white"
                >
                  View all programs
                </Link>
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      <div className="relative border-t border-accent/20 bg-black/5 px-3 py-3">
        <Link
          href="/people"
          onClick={onMobileClose}
          className="flex items-center gap-2.5 rounded-(--radius-sm) px-1.5 py-1.5 transition-colors hover:bg-white/8"
        >
          <span className="rounded-full ring-1 ring-accent/25">
            <Avatar name={userName} src={userAvatarUrl} size="md" />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-bold text-white">
              {userName}
            </span>
            {userTitle ? (
              <span className="block truncate text-[11.5px] text-white/58">
                {userTitle}
              </span>
            ) : null}
          </span>
          <ChevronRight className="size-4 text-accent/80" aria-hidden />
        </Link>
      </div>
    </nav>
  );

  return (
    <>
      <aside className="qbbe-sidebar hidden w-[248px] shrink-0 lg:block">
        {nav}
      </aside>
      {mobileOpen ? (
        <MobileNavDrawer onClose={onMobileClose}>{nav}</MobileNavDrawer>
      ) : null}
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

function MobileNavDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const panel = panelRef.current;
    const returnTo = document.activeElement as HTMLElement | null;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-ink/50"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="qbbe-sidebar absolute inset-y-0 left-0 w-72 shadow-(--shadow-pop)"
      >
        {children}
      </aside>
    </div>
  );
}
