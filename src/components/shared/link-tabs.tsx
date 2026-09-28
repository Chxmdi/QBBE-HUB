"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export interface LinkTab {
  id: string;
  label: string;
  href: string;
  count?: number;
}

/**
 * Server-rendered tabs backed by URL state, so a tab is shareable and
 * survives reload. Horizontally scrollable on mobile (§10.5).
 */
export function LinkTabs({
  tabs,
  active,
  className,
}: {
  tabs: LinkTab[];
  active: string;
  className?: string;
}) {
  const t = useT();
  return (
    <nav
      aria-label={t("ui.sections")}
      className={cn(
        "-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap",
              "transition-colors duration-(--duration-fast)",
              selected
                ? "border-brand text-brand-fg"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ml-1.5 text-[12px] text-muted">{tab.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
