"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/finance/ledger", label: "Overview" },
  { href: "/finance/ledger/journal", label: "Journal" },
  { href: "/finance/ledger/trial-balance", label: "Trial balance" },
  { href: "/finance/ledger/general-ledger", label: "General ledger" },
  { href: "/finance/ledger/accounts", label: "Accounts" },
  { href: "/finance/ledger/funds", label: "Funds" },
  { href: "/finance/ledger/periods", label: "Periods" },
  { href: "/finance/ledger/statements", label: "Statements" },
  { href: "/finance/ledger/receipts", label: "Receipts" },
  { href: "/finance/ledger/year-end", label: "Year-end" },
  { href: "/finance/ledger/returns", label: "Returns" },
];

/** Sections of the ledger, as plain links so each is its own page and URL. */
export function LedgerTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Ledger sections" className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
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
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
