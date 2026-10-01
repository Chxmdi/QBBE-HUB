"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Home,
  MessagesSquare,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isUnder, navHref, type NavSwitches } from "@/config/navigation";
import { useT } from "@/lib/i18n/client";

/**
 * Mobile bottom navigation (Part II §11.1): Home, My Work, Channels,
 * Calendar, More. Secondary modules stay reachable through More, which
 * opens the full sidebar drawer. Targets meet the 44px minimum (A11Y-005).
 * Each tab follows the sidebar: while a Workspace OS switch is on, Home, My
 * Work and Calendar open the new screen (epic #199, plan §9).
 */
export function MobileNav({
  switches,
  myWorkCount,
  onOpenMore,
}: {
  isAdmin: boolean;
  isStaff: boolean;
  switches?: NavSwitches;
  myWorkCount: number;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const t = useT();

  const tabs = [
    { label: t("nav.items.home"), href: navHref("/", switches), icon: Home, badge: 0 },
    { label: t("nav.items.myWork"), href: navHref("/my-work", switches), icon: ClipboardList, badge: myWorkCount },
    { label: t("nav.items.channels"), href: "/channels", icon: MessagesSquare, badge: 0 },
    { label: t("nav.items.calendar"), href: navHref("/calendar", switches), icon: CalendarDays, badge: 0 },
  ];

  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-(--z-chrome) border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => {
          const active = isUnder(pathname, tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 py-1.5",
                  "text-[10.5px] font-medium transition-colors",
                  active ? "text-brand-fg" : "text-muted",
                )}
              >
                <tab.icon className="size-5" aria-hidden />
                {tab.label}
                {tab.badge > 0 ? (
                  <span className="absolute top-1 right-[22%] min-w-4 rounded-full bg-brand px-1 text-[9.5px] leading-4 font-semibold text-white">
                    {tab.badge > 9 ? "9+" : tab.badge}
                    {/* aria-label is ignored on a bare span; a bare number
                        also reads as part of the tab label. */}
                    <span className="sr-only">{t("common.openItems")}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            aria-label={t("nav.moreDestinations")}
            className="flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[10.5px] font-medium text-muted"
          >
            <MoreHorizontal className="size-5" aria-hidden />
            {t("nav.more")}
          </button>
        </li>
      </ul>
    </nav>
  );
}
