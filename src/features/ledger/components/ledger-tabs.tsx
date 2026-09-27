"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

const SECTIONS: { href: string; label: MessageKey }[] = [
  { href: "/finance/ledger", label: "finance.ledger.tabs.overview" },
  { href: "/finance/ledger/journal", label: "finance.ledger.tabs.journal" },
  { href: "/finance/ledger/trial-balance", label: "finance.ledger.tabs.trialBalance" },
  { href: "/finance/ledger/general-ledger", label: "finance.ledger.tabs.generalLedger" },
  { href: "/finance/ledger/accounts", label: "finance.ledger.tabs.accounts" },
  { href: "/finance/ledger/funds", label: "finance.ledger.tabs.funds" },
  { href: "/finance/ledger/periods", label: "finance.ledger.tabs.periods" },
  { href: "/finance/ledger/statements", label: "finance.ledger.tabs.statements" },
  { href: "/finance/ledger/receipts", label: "finance.ledger.tabs.receipts" },
  { href: "/finance/ledger/year-end", label: "finance.ledger.tabs.yearEnd" },
  { href: "/finance/ledger/returns", label: "finance.ledger.tabs.returns" },
];

/** Sections of the ledger, as plain links so each is its own page and URL. */
export function LedgerTabs() {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav
      aria-label={t("finance.ledger.tabs.navLabel")}
      className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0"
    >
      <ul className="flex gap-1">
        {SECTIONS.map((s) => {
          const active =
            s.href === "/finance/ledger" ? pathname === s.href : pathname.startsWith(s.href);
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-brand text-ink"
                    : "border-transparent text-muted hover:text-ink",
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
