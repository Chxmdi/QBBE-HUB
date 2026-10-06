import Link from "next/link";
import type { Formatters } from "@/lib/i18n/format";
import type { HomeFact, HomeItem } from "../model";
import { homeEn } from "../i18n/en";
import type { HomeT } from "../i18n";

const HEALTH = homeEn.health;

/** One fact under an item, in words. */
export function factText(fact: HomeFact, t: HomeT, format: Formatters, timeZone: string): string {
  switch (fact.kind) {
    case "due":
      if (fact.today) return t("fact.dueToday");
      return t(fact.overdue ? "fact.overdue" : "fact.due", { date: format.date(fact.date, timeZone) });
    case "status":
      return t(`status.${fact.status}`);
    case "project":
      return t("fact.project", { name: fact.name });
    case "time":
      return format.dateTime(fact.at, timeZone);
    case "person":
      return t("fact.person", { name: fact.name });
    case "reason":
      return t("fact.reason", { text: fact.text });
    case "role":
      return t(`fact.${fact.role}`);
    case "health":
      // An unrecognised health value is shown as stored rather than as a key.
      return fact.health in HEALTH ? t(`health.${fact.health as keyof typeof HEALTH}`) : fact.health;
    case "summary":
      return fact.text;
  }
}

/**
 * A titled list on Home or My World. The heading names the region, so a
 * screen reader can jump between sections; an empty section says so in words.
 */
export function HomeSection({
  id,
  title,
  empty,
  items,
  t,
  format,
  timeZone,
  children,
}: {
  id: string;
  title: string;
  empty: string;
  items: HomeItem[];
  t: HomeT;
  format: Formatters;
  timeZone: string;
  /** Extra content per item, keyed by item key (the attention explanation). */
  children?: (item: HomeItem) => React.ReactNode;
}) {
  const headingId = `home-${id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-(--radius-md) border border-line bg-surface p-4">
      <h2 id={headingId} className="flex items-baseline justify-between gap-2 text-[15px] font-semibold text-ink">
        <span>{title}</span>
        {items.length ? (
          <span className="text-xs font-normal text-muted">{t("count", { count: items.length })}</span>
        ) : null}
      </h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {items.map((item) => {
            const facts = item.facts.map((fact) => factText(fact, t, format, timeZone)).filter(Boolean);
            const overdue = item.facts.some((fact) => fact.kind === "due" && fact.overdue);
            return (
              <li key={item.key} className="py-2">
                <Link href={item.href} className="text-sm font-medium text-ink hover:text-brand-fg hover:underline">
                  {item.title || t("fact.approvalFallback")}
                </Link>
                {facts.length ? (
                  <p className={overdue ? "mt-0.5 text-xs text-danger-fg" : "mt-0.5 text-xs text-muted"}>
                    {facts.join(" · ")}
                  </p>
                ) : null}
                {children?.(item)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
