"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/finance/payables", label: "Bills" },
  { href: "/finance/payables/invoices", label: "Invoices" },
  { href: "/finance/payables/contacts", label: "Vendors and customers" },
  { href: "/finance/payables/aging", label: "Aging" },
];

/** Sections of payables and receivables, as plain links. */
export function PayablesTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Bills and invoices sections" className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
      <ul className="flex gap-1">
        {SECTIONS.map((s) => {
          const active =
            s.href === "/finance/payables"
              ? pathname === s.href || pathname.startsWith("/finance/payables/bills")
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
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
