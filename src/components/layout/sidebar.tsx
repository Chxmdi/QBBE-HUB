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
  "#C8A64D", "#4C8BF5", "#3FA96E", "#B85FD0", "#E0763A", "#D9556B",
];

function programDot(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return PROGRAM_DOT_COLORS[hash % PROGRAM_DOT_COLORS.length];
}

/**
 * Dark QBBE navigation shell with warm light workspace (Part III §2.1).
 * Grouped Work / Communication / Organization / Programs with live,
 * permission-aware counts (Part IV §5.2).
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
      {/* Decorative brand base — pure ornament, hidden from AT */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36"
        style={{
          background:
            "radial-gradient(120% 90% at 15% 100%, rgba(143,21,56,0.55) 0%, rgba(200,166,77,0.12) 55%, transparent 78%)",
        }}
      />

      <div className="flex items-center px-4 pt-5 pb-5">
        <Link href="/" onClick={onMobileClose} aria-label="QBBE Hub home">
          <QbbeLogo />
        </Link>
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Close navigation"
          className="ml-auto rounded p-1 text-white/60 hover:text-white lg:hidden"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-white/70 uppercase">
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
                        "flex items-center gap-2.5 rounded-(--radius-sm) px-2 py-[7px] text-[13.5px] font-medium",
                        "transition-colors duration-(--duration-fast)",
                        active
                          ? "bg-brand text-white shadow-(--shadow-raise)"
                          : "text-white/70 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                      {badge > 0 ? (
                        <span
                          className={cn(
                            "ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] leading-none font-semibold",
                            active ? "bg-white/25 text-white" : "bg-accent/90 text-[#221219]",
                          )}
                        >
                          {badge > 99 ? "99+" : badge}
                          {/* aria-label is ignored on a bare span; a bare
                              number also reads as part of the link text. */}
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
            <p className="px-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-white/70 uppercase">
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
                        "flex items-center gap-2 rounded-(--radius-sm) px-2 py-[6px] text-[13.5px]",
                        "transition-colors duration-(--duration-fast)",
                        active
                          ? "bg-brand text-white"
                          : channel.unread
                            ? "font-semibold text-white hover:bg-white/8"
                            : "text-white/70 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <span aria-hidden className="text-white/70">
                        #
                      </span>
                      <span className="truncate">{channel.slug}</span>
                      {channel.unread ? (
                        <>
                          <span className="sr-only">Unread messages</span>
                          <span
                            aria-hidden
                            className="ml-auto size-1.5 rounded-full bg-accent"
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
            <p className="flex items-center justify-between px-2 pb-1.5 text-[10.5px] font-semibold tracking-[0.12em] text-white/70 uppercase">
              Programs
              <Link
                href="/programs"
                onClick={onMobileClose}
                aria-label="Add or manage programs"
                className="rounded p-0.5 text-white/70 hover:text-white"
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
                        "flex items-center gap-2.5 rounded-(--radius-sm) px-2 py-[6px] text-[13.5px]",
                        active
                          ? "bg-brand text-white"
                          : "text-white/70 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
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
                  className="block rounded-(--radius-sm) px-2 py-[6px] text-[12.5px] text-white/50 hover:bg-white/8 hover:text-white"
                >
                  View all programs
                </Link>
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      {/* User footer */}
      <div className="relative border-t border-white/10 px-3 py-3">
        <Link
          href="/people"
          onClick={onMobileClose}
          className="flex items-center gap-2.5 rounded-(--radius-sm) px-1.5 py-1.5 transition-colors hover:bg-white/8"
        >
          <Avatar name={userName} src={userAvatarUrl} size="md" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-white">
              {userName}
            </span>
            {userTitle ? (
              <span className="block truncate text-[11.5px] text-white/50">
                {userTitle}
              </span>
            ) : null}
          </span>
          <ChevronRight className="size-4 text-white/70" aria-hidden />
        </Link>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="hidden w-[248px] shrink-0 bg-[#221219] lg:block dark:bg-[#1d1116]">
        {nav}
      </aside>
      {/* Mobile drawer */}
      {mobileOpen ? (
        <MobileNavDrawer onClose={onMobileClose}>{nav}</MobileNavDrawer>
      ) : null}
    </>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The mobile navigation covers the page like a modal, so it has to behave
 * like one: it was previously a plain overlay a keyboard user could tab
 * straight out of, with no way to dismiss it and no way back to the trigger.
 */
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
      // Wrap at both ends, and pull focus back in if it escaped the panel.
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
      // Focus goes back to whatever opened the drawer, not to the page top.
      returnTo?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* A click-catcher, not a control: the panel's own close button and
          Escape are the accessible ways out, so keep it out of the trap. */}
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
        className="absolute inset-y-0 left-0 w-72 bg-[#221219] shadow-(--shadow-pop)"
      >
        {children}
      </aside>
    </div>
  );
}
