"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn, relativeTime } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Notification } from "@/types/entities";

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

export function Topbar({
  name,
  avatarUrl,
  isStaff,
  unreadCount,
  onOpenNav,
  onOpenPalette,
}: {
  name: string;
  avatarUrl: string | null;
  isStaff: boolean;
  unreadCount: number;
  onOpenNav: () => void;
  onOpenPalette: () => void;
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [openMenu, setOpenMenu] = useState<
    "notifications" | "create" | "profile" | null
  >(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [badge, setBadge] = useState(unreadCount);
  const router = useRouter();
  const menuRef = useClickOutside(() => setOpenMenu(null));

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("qbbe-theme", next);
    } catch {}
  }

  async function openNotifications() {
    if (openMenu === "notifications") {
      setOpenMenu(null);
      return;
    }
    setOpenMenu("notifications");
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("notification")
      .select("id, category, title, body, link, urgency, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(12);
    setNotifications((data as Notification[] | null) ?? []);
  }

  async function markAllRead() {
    const supabase = createSupabaseBrowserClient();
    await supabase
      .from("notification")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    setBadge(0);
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
  }

  const createLinks = [
    { label: "Task", href: "/my-work?create=task" },
    ...(isStaff
      ? [
          { label: "Project", href: "/projects?create=1" },
          { label: "Meeting", href: "/meetings?create=1" },
          { label: "Event", href: "/events?create=1" },
          { label: "Channel", href: "/channels?create=1" },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur md:px-5">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="rounded-(--radius-sm) p-2 text-muted hover:bg-surface-soft hover:text-ink lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex h-9 flex-1 items-center gap-2 rounded-(--radius-sm) border border-line bg-surface px-3 text-left text-[13.5px] text-muted transition-colors hover:border-brand/40 md:max-w-md"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 truncate">Search or jump to…</span>
        <kbd className="hidden rounded border border-line bg-surface-soft px-1.5 py-0.5 text-[11px] md:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1" ref={menuRef}>
        {/* Quick create (P0-QC-01) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === "create" ? null : "create")}
            aria-label="Quick create"
            aria-expanded={openMenu === "create"}
            className="flex size-9 items-center justify-center rounded-(--radius-sm) bg-brand text-white transition-colors hover:bg-brand-strong"
          >
            <Plus className="size-4.5" aria-hidden />
          </button>
          {openMenu === "create" ? (
            <div className="absolute right-0 mt-2 w-44 rounded-(--radius-sm) border border-line bg-surface py-1 shadow-(--shadow-pop)">
              {createLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpenMenu(null)}
                  className="block px-3 py-1.5 text-[13.5px] hover:bg-surface-soft"
                >
                  New {l.label.toLowerCase()}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            onClick={openNotifications}
            aria-label={`Notifications${badge > 0 ? ` (${badge} unread)` : ""}`}
            aria-expanded={openMenu === "notifications"}
            className="relative flex size-9 items-center justify-center rounded-(--radius-sm) text-muted transition-colors hover:bg-surface-soft hover:text-ink"
          >
            <Bell className="size-4.5" aria-hidden />
            {badge > 0 ? (
              <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-brand text-[9.5px] font-semibold text-white">
                {badge > 9 ? "9+" : badge}
              </span>
            ) : null}
          </button>
          {openMenu === "notifications" ? (
            <div className="absolute right-0 mt-2 w-80 rounded-(--radius-md) border border-line bg-surface shadow-(--shadow-pop)">
              <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                <p className="text-[13px] font-semibold">Notifications</p>
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[12px] font-medium text-brand hover:underline"
                >
                  Mark all read
                </button>
              </div>
              <ul className="max-h-96 overflow-y-auto py-1">
                {notifications.length === 0 ? (
                  <li className="px-3.5 py-6 text-center text-[13px] text-muted">
                    You&apos;re all caught up.
                  </li>
                ) : (
                  notifications.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          if (n.link) router.push(n.link);
                        }}
                        className={cn(
                          "w-full px-3.5 py-2 text-left text-[13px] hover:bg-surface-soft",
                          !n.read_at && "bg-brand-soft/40",
                        )}
                      >
                        <span className="flex items-start gap-2">
                          {!n.read_at ? (
                            <span
                              aria-label="Unread"
                              className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                            />
                          ) : (
                            <span className="mt-1.5 size-1.5 shrink-0" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {n.title}
                            </span>
                            {n.body ? (
                              <span className="block truncate text-muted">
                                {n.body}
                              </span>
                            ) : null}
                            <span className="meta">
                              {relativeTime(n.created_at)}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <Link
                href="/inbox"
                onClick={() => setOpenMenu(null)}
                className="block border-t border-line px-3.5 py-2 text-center text-[12.5px] font-medium text-brand hover:underline"
              >
                Open Inbox
              </Link>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          className="flex size-9 items-center justify-center rounded-(--radius-sm) text-muted transition-colors hover:bg-surface-soft hover:text-ink"
        >
          {theme === "dark" ? (
            <Sun className="size-4.5" aria-hidden />
          ) : (
            <Moon className="size-4.5" aria-hidden />
          )}
        </button>

        {/* Profile */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}
            aria-label="Account menu"
            aria-expanded={openMenu === "profile"}
            className="ml-1 flex items-center rounded-full"
          >
            <Avatar name={name} src={avatarUrl} size="md" />
          </button>
          {openMenu === "profile" ? (
            <div className="absolute right-0 mt-2 w-48 rounded-(--radius-sm) border border-line bg-surface py-1 shadow-(--shadow-pop)">
              <p className="truncate px-3 py-2 text-[13px] font-medium">
                {name}
              </p>
              <form action="/auth/sign-out" method="post">
                <button
                  type="submit"
                  className="w-full px-3 py-1.5 text-left text-[13.5px] text-danger hover:bg-surface-soft"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
