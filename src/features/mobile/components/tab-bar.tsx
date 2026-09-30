"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckSquare, Inbox, PlusCircle, Search, Stamp, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileT } from "./use-mobile-t";

const TABS = [
  { href: "/m/today", key: "today", Icon: Sun },
  { href: "/m/tasks", key: "tasks", Icon: CheckSquare },
  { href: "/m/capture", key: "capture", Icon: PlusCircle },
  { href: "/m/inbox", key: "inbox", Icon: Inbox },
  { href: "/m/search", key: "search", Icon: Search },
  { href: "/m/approvals", key: "approvals", Icon: Stamp },
] as const;

/**
 * Navigation between the phone screens, 48px targets, at the top of the page:
 * the workspace already has its own fixed bar at the bottom of a phone
 * screen, and two stacked bars would cover each other.
 */
export function TabBar() {
  const t = useMobileT();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("nav.label")}
      className="mb-4 rounded-(--radius-sm) border border-line bg-surface"
    >
      <ul className="mx-auto grid max-w-md grid-cols-6">
        {TABS.map(({ href, key, Icon }) => {
          const active = pathname === href;
          return (
            <li key={key}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px]",
                  active ? "font-semibold text-brand-fg" : "text-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span className="max-w-full truncate">{t(`nav.${key}`)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
