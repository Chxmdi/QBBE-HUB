"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/finance/gifts", label: "Gifts" },
  { href: "/finance/gifts/donors", label: "Donors" },
  { href: "/finance/gifts/statement", label: "Annual statements" },
  { href: "/finance/gifts/grants", label: "Grants" },
];

/** Sections of gifts and grants (#156), as plain links. */
export function GiftTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Gift sections" className="mb-6 -mx-4 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
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
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
