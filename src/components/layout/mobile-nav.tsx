"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeNavHref, isUnder, mobileTabs, navBadge, visibleNav, type NavSwitches } from "@/config/navigation";
import type { SidebarCounts } from "@/components/layout/sidebar";
import { useT } from "@/lib/i18n/client";
import { navGroupLabel, navItemLabel } from "@/lib/i18n/navigation";

/**
 * Mobile bottom navigation (Part II §11.1): Home, My Work, Channels,
 * Calendar, More. Secondary modules stay reachable through More, which
 * opens the full sidebar drawer. Targets meet the 44px minimum (A11Y-005).
 *
 * The tabs are drawn from the same `visibleNav` output as the sidebar, so a
 * tab follows the sidebar: while a Workspace OS switch is on, Home, My Work
 * and Calendar open the new screen (epic #199, plan §9), and with the
 * consolidated menu (`wos_home`) the tabs are Home, My Work, Pages and
 * Communication, each opening its group's first screen.
 */
export function MobileNav({
  isAdmin,
  isStaff,
  switches,
  counts,
  onOpenMore,
}: {
  isAdmin: boolean;
  isStaff: boolean;
  switches?: NavSwitches;
  counts: SidebarCounts;
  onOpenMore: () => void;
}) {
  const pathname = usePathname();
  const t = useT();
  const groups = visibleNav({ isAdmin, isStaff }, switches);
  const tabs = mobileTabs(groups, switches);
  // The sidebar's own rule (the most specific entry), so "/spaces/admin"
  // lights Setup's entry and not the Pages tab through "/spaces".
  const activeHref = activeNavHref(groups, pathname);

  return (
    <nav
      aria-label={t("nav.primary")}
      className="fixed inset-x-0 bottom-0 z-(--z-chrome) border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => {
          // A group tab is current on the screen of its group the sidebar marks; a screen tab only on its own.
          const active = tab.group
            ? tab.group.items.some((item) => item.href === activeHref)
            : isUnder(pathname, tab.item.href);
          const label = tab.group ? navGroupLabel(t, tab.group) : navItemLabel(t, tab.item);
          const badge = navBadge(tab.item, counts);
          const Icon = tab.item.icon;
          return (
            <li key={tab.item.href} className="min-w-0 flex-1">
              <Link
                href={tab.item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 py-1.5",
                  "text-[10.5px] font-medium transition-colors",
                  active ? "text-brand-fg" : "text-muted",
                )}
              >
                <Icon className="size-5" aria-hidden />
                {/* Hyphenate rather than cut: "Communication" is wider than a tab at 320px. */}
                <span className="max-w-full text-center leading-tight hyphens-auto [overflow-wrap:anywhere]">{label}</span>
                {badge > 0 ? (
                  <span className="absolute top-1 right-[22%] min-w-4 rounded-full bg-brand px-1 text-[9.5px] leading-4 font-semibold text-white">
                    {badge > 9 ? "9+" : badge}
                    {/* aria-label is ignored on a bare span; a bare number
                        also reads as part of the tab label. */}
                    <span className="sr-only">{t("common.openItems")}</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        <li className="min-w-0 flex-1">
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
