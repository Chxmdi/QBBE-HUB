"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

const SECTIONS: { href: string; label: MessageKey }[] = [
  { href: "/finance/gifts", label: "finance.gifts.tabs.gifts" },
  { href: "/finance/gifts/donors", label: "finance.gifts.tabs.donors" },
  { href: "/finance/gifts/statement", label: "finance.gifts.tabs.statements" },
  { href: "/finance/gifts/grants", label: "finance.gifts.tabs.grants" },
];

/** Sections of gifts and grants (#156), as plain links. */
export function GiftTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label={t("finance.gifts.tabs.ariaLabel")} className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        {SECTIONS.map((s) => {
          const active =
            s.href === "/finance/gifts"
              ? pathname === s.href || /^\/finance\/gifts\/[0-9a-f-]{36}/.test(pathname)
              : pathname.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
                  active ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {t(s.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
