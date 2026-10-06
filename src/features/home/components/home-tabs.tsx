import Link from "next/link";
import { cn } from "@/lib/utils";
import type { HomeT } from "../i18n";

/** Home, My World and Commands, as links so each view has its own address. */
export function HomeTabs({ active, t }: { active: "home" | "world" | "commands"; t: HomeT }) {
  const tabs = [
    { id: "home", href: "/home", label: t("page.home") },
    { id: "world", href: "/home/world", label: t("page.world") },
    { id: "commands", href: "/home/commands", label: t("page.commands") },
  ] as const;
  return (
    <nav aria-label={t("page.tabs")} className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            tab.id === active ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
