import Link from "next/link";
import type { Formatters } from "@/lib/i18n/format";
import type { DigestEntry } from "../digest";
import { homeEn } from "../i18n/en";
import type { HomeT } from "../i18n";

const STATUS = homeEn.status;
const HEALTH = homeEn.health;
const DECISION = homeEn.digest.decision;

function known<T extends object>(table: T, key: string | null): key is Extract<keyof T, string> {
  return key !== null && key in table;
}

/** The facts of one change, in words. */
export function digestDetail(entry: DigestEntry, t: HomeT, format: Formatters, timeZone: string): string {
  const date = (value: string | null) => (value ? format.date(value, timeZone) : "");
  const status = (value: string | null) => (known(STATUS, value) ? t(`status.${value}`) : (value ?? ""));
  const health = (value: string | null) => (known(HEALTH, value) ? t(`health.${value}`) : (value ?? ""));
  const number = (value: number | null, unit: string | null) =>
    value === null ? "" : `${format.number(value)}${unit ? ` ${unit}` : ""}`;
  const { detail } = entry;
  switch (detail.kind) {
    case "newly_blocked":
      return detail.reason ? t("digest.detail.blockedBecause", { reason: detail.reason }) : "";
    case "deadline_moved":
      if (!detail.to) return t("digest.detail.dateRemoved", { from: date(detail.from) });
      if (!detail.from) return t("digest.detail.dateAdded", { to: date(detail.to) });
      return t(detail.sooner ? "digest.detail.movedSooner" : "digest.detail.moved", { from: date(detail.from), to: date(detail.to) });
    case "status_changed":
      return detail.from
        ? t("digest.detail.change", { from: status(detail.from), to: status(detail.to) })
        : t("digest.detail.now", { to: status(detail.to) });
    case "completed":
      return "";
    case "approval_requested":
      return detail.by ? t("digest.detail.requestedBy", { name: detail.by }) : "";
    case "approval_decided":
      return known(DECISION, detail.decision) ? t(`digest.decision.${detail.decision}`) : detail.decision;
    case "health_changed":
      return detail.from
        ? t("digest.detail.change", { from: health(detail.from), to: health(detail.to) })
        : t("digest.detail.now", { to: health(detail.to) });
    case "number_changed":
      return detail.from === null
        ? t("digest.detail.now", { to: number(detail.to, detail.unit) })
        : t("digest.detail.change", { from: number(detail.from, detail.unit), to: number(detail.to, detail.unit) });
  }
}

/** "While you were away" (M17d), at the top of Home. */
export function DigestSection({
  entries,
  since,
  firstVisit,
  t,
  format,
  timeZone,
}: {
  entries: DigestEntry[];
  since: string;
  firstVisit: boolean;
  t: HomeT;
  format: Formatters;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="home-digest" className="mb-4 rounded-(--radius-md) border border-line bg-surface p-4">
      <h2 id="home-digest" className="text-[15px] font-semibold text-ink">
        {t("digest.title")}
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        {firstVisit ? t("digest.sinceFirst") : t("digest.since", { date: format.dateTime(since, timeZone) })}
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("digest.empty")}</p>
      ) : (
        <ol className="mt-2 divide-y divide-line">
          {entries.map((entry) => {
            const detail = digestDetail(entry, t, format, timeZone);
            const facts = [
              detail,
              entry.by ? t("digest.by", { name: entry.by }) : "",
              entry.count > 1 ? t("digest.times", { count: entry.count }) : "",
              format.dateTime(entry.at, timeZone),
            ].filter(Boolean);
            return (
              <li key={entry.key} className="py-2">
                <p className="text-xs font-medium text-brand-fg">{t(`digest.kind.${entry.kind}`)}</p>
                <Link href={entry.href} className="text-sm font-medium text-ink hover:text-brand-fg hover:underline">
                  {entry.title || t("fact.approvalFallback")}
                </Link>
                <p className="mt-0.5 text-xs text-muted">{facts.join(" · ")}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
