"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

const SECTIONS: { href: string; label: MessageKey }[] = [
  { href: "/finance/sales-tax", label: "finance.salesTax.tabs.overview" },
  { href: "/finance/sales-tax/lines", label: "finance.salesTax.tabs.lines" },
  { href: "/finance/sales-tax/worksheet", label: "finance.salesTax.tabs.worksheet" },
];

/** Sections of GST/QST, as plain links so each is its own page and URL. */
export function TaxTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label={t("finance.salesTax.tabs.aria")} className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        {SECTIONS.map((s) => {
          const active =
            s.href === "/finance/sales-tax" ? pathname === s.href : pathname.startsWith(s.href);
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
