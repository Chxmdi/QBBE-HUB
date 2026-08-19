"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Administration is one area with several surfaces. This is the same quiet
 * underline treatment as the in-page tabs, but built from real links so each
 * surface keeps its own URL, its own back-button entry, and its own data fetch.
 */
const ADMIN_SECTIONS = [
  { href: "/admin", label: "Workspace" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/email", label: "Email" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Administration sections" className="mb-6">
      <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
        {ADMIN_SECTIONS.map((section) => {
          const current = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px block shrink-0 border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap",
                  "transition-colors duration-(--duration-fast)",
                  current
                    ? "border-brand text-brand-fg"
                    : "border-transparent text-muted hover:text-ink",
                )}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
