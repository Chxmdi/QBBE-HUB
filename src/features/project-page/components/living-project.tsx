import Link from "next/link";
import type { Formatters } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { HealthReason, ProjectHealth } from "../health";
import type { BlockRow } from "../run-blocks";
import type { BlockKey } from "../blocks";
import { projectPageEn } from "../i18n/en";
import type { ProjectPageT } from "../i18n";

const STATUS = projectPageEn.value.status;
const LEVEL = projectPageEn.value.level;
const HEALTH = projectPageEn.health.level;

function known<T extends object>(table: T, key: unknown): key is Extract<keyof T, string> {
  return typeof key === "string" && key in table;
}

export function reasonText(reason: HealthReason, t: ProjectPageT, format: Formatters, timeZone: string): string {
  switch (reason.rule) {
    case "target_passed":
      return t("health.reason.target_passed", { date: format.date(reason.date, timeZone) });
    case "milestones_overdue":
      return reason.count === 1
        ? t("health.reason.milestones_overdue_one")
        : t("health.reason.milestones_overdue_many", { count: reason.count });
    case "tasks_overdue":
      return t("health.reason.tasks_overdue", { count: reason.count, open: reason.open });
    case "tasks_blocked":
      return reason.count === 1 ? t("health.reason.tasks_blocked_one") : t("health.reason.tasks_blocked_many", { count: reason.count });
    case "severe_risks":
      return reason.count === 1 ? t("health.reason.severe_risks_one") : t("health.reason.severe_risks_many", { count: reason.count });
    case "deadline_pressure":
      return t("health.reason.deadline_pressure", { percent: reason.percent, days: reason.days });
  }
}

const HEALTH_TONE: Record<string, string> = {
  on_track: "text-success-fg",
  completed: "text-success-fg",
  at_risk: "text-warning-fg",
  off_track: "text-danger-fg",
};

export function healthLabel(health: string, t: ProjectPageT): string {
  return known(HEALTH, health) ? t(`health.level.${health}`) : health;
}

/** Calculated health beside the reported one, with the reasons (M19a). */
export function HealthPanel({
  calculated,
  reported,
  t,
  format,
  timeZone,
}: {
  calculated: ProjectHealth;
  reported: string;
  t: ProjectPageT;
  format: Formatters;
  timeZone: string;
}) {
  const { progress } = calculated;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby="project-health" className="rounded-(--radius-md) border border-line bg-surface p-4">
        <h2 id="project-health" className="text-[15px] font-semibold text-ink">{t("health.title")}</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">{t("health.calculated")}</dt>
          <dd className={cn("font-semibold", HEALTH_TONE[calculated.health])}>{healthLabel(calculated.health, t)}</dd>
          <dt className="text-muted">{t("health.reported")}</dt>
          <dd className={cn(HEALTH_TONE[reported] ?? "text-ink")}>{healthLabel(reported, t)}</dd>
        </dl>
        <h3 className="mt-3 text-xs font-medium text-muted">{t("health.why")}</h3>
        {calculated.reasons.length === 0 ? (
          <p className="mt-1 text-sm text-ink">{t("health.none")}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
            {calculated.reasons.map((reason) => (
              <li key={reason.rule}>{reasonText(reason, t, format, timeZone)}</li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="project-progress" className="rounded-(--radius-md) border border-line bg-surface p-4">
        <h2 id="project-progress" className="text-[15px] font-semibold text-ink">{t("progress.title")}</h2>
        {progress.percent === null ? (
          <p className="mt-2 text-sm text-muted">{t("progress.unknown")}</p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold text-ink">{format.number(progress.percent)}%</p>
            <div
              role="progressbar"
              aria-label={t("progress.label")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              className="mt-2 h-2 overflow-hidden rounded-full bg-surface-soft"
            >
              <div className="h-full bg-brand" style={{ width: `${progress.percent}%` }} />
            </div>
            <ul className="mt-2 space-y-0.5 text-sm text-muted">
              {progress.tasks.total > 0 ? <li>{t("progress.tasks", { done: progress.tasks.done, total: progress.tasks.total })}</li> : null}
              {progress.milestones.total > 0 ? (
                <li>{t("progress.milestones", { done: progress.milestones.done, total: progress.milestones.total })}</li>
              ) : null}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/** The facts shown under one row of a block. */
export function rowFacts(key: BlockKey, row: BlockRow, t: ProjectPageT, format: Formatters, timeZone: string): string[] {
  const value = (name: string) => {
    const found = row.values[name];
    return found && "value" in found ? found.value : null;
  };
  const status = (raw: unknown) => (known(STATUS, raw) ? t(`value.status.${raw}`) : raw ? String(raw) : null);
  const level = (raw: unknown) => (known(LEVEL, raw) ? t(`value.level.${raw}`) : String(raw ?? ""));
  const date = (raw: unknown) => (typeof raw === "string" ? format.date(raw, timeZone) : null);
  const facts: (string | null)[] = [];
  switch (key) {
    case "openTasks":
      facts.push(status(value("status")), value("due") ? t("value.due", { date: date(value("due"))! }) : null);
      break;
    case "decisions":
      facts.push(value("decided_time") ? t("value.decided", { date: date(value("decided_time"))! }) : null);
      break;
    case "milestones":
      facts.push(status(value("completed_time") ? "completed" : value("status")), value("due") ? t("value.due", { date: date(value("due"))! }) : null);
      break;
    case "files":
      facts.push(value("edited_time") ? t("value.updated", { date: date(value("edited_time"))! }) : null);
      break;
    case "activity":
      facts.push(typeof value("created_time") === "string" ? format.dateTime(value("created_time") as string, timeZone) : null);
      break;
    case "risks":
      facts.push(
        status(value("status")),
        value("likelihood") ? t("value.likelihood", { level: level(value("likelihood")) }) : null,
        value("impact") ? t("value.impact", { level: level(value("impact")) }) : null,
      );
      break;
  }
  return facts.filter((fact): fact is string => Boolean(fact));
}

/** One query block (M19b). */
export function BlockSection({
  blockKey,
  href,
  rows,
  t,
  format,
  timeZone,
}: {
  blockKey: BlockKey;
  href: string;
  rows: BlockRow[] | null;
  t: ProjectPageT;
  format: Formatters;
  timeZone: string;
}) {
  const headingId = `block-${blockKey}`;
  return (
    <section aria-labelledby={headingId} className="rounded-(--radius-md) border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-[15px] font-semibold text-ink">
          {t(`block.${blockKey}.title`)}
        </h2>
        <Link href={href} className="text-xs text-brand-fg underline hover:no-underline">
          {t("block.seeAll")}
          <span className="sr-only"> {t(`block.${blockKey}.title`)}</span>
        </Link>
      </div>
      {rows === null ? (
        <p className="mt-2 text-sm text-danger-fg">{t("block.failed")}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t(`block.${blockKey}.empty`)}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => {
            const facts = rowFacts(blockKey, row, t, format, timeZone);
            return (
              <li key={row.ref.id} className="py-2">
                <Link href={row.href} className="text-sm font-medium text-ink hover:text-brand-fg hover:underline">
                  {row.title.split("\n")[0]}
                </Link>
                {facts.length ? <p className="mt-0.5 text-xs text-muted">{facts.join(" · ")}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
