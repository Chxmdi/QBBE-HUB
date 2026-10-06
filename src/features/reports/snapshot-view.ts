import type { Formatters } from "@/lib/i18n/format";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

export interface SnapshotRow {
  primary: string;
  secondary?: string;
}

export interface SnapshotSection {
  title: string;
  rows: SnapshotRow[];
}

function asRows(value: unknown, map: (row: Record<string, unknown>) => SnapshotRow): SnapshotRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => map((row ?? {}) as Record<string, unknown>));
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

const english = createTranslator("en");

/**
 * The label for a stored code (a health, stage, status or metric name), or the
 * code with its underscores spaced out when the catalogue has no label for it.
 * `t()` hands back the key itself for a missing key, which is how one is spotted.
 */
export function codeLabel(t: TranslateFn, group: string, code: unknown): string {
  const raw = text(code);
  if (!raw) return "";
  const key = `${group}.${raw}`;
  const label = t(key as MessageKey);
  return label === key ? raw.replace(/_/g, " ") : label;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Shows a stored value as a date a person reads. A bare `YYYY-MM-DD` is a
 * calendar date with no zone, so it is written out in UTC — reading it in
 * Toronto would move it to the evening before. Instants get a date and time.
 */
export function formatStoredDate(format: Formatters, value: string | null | undefined): string {
  if (!value) return "—";
  if (DATE_ONLY.test(value)) {
    return format.inZone(value, "UTC", { year: "numeric", month: "short", day: "numeric" });
  }
  const shown = format.dateTime(value);
  return shown === "—" ? value : shown;
}

export interface SnapshotViewOptions {
  /** Section titles and row wording. English when left out. */
  t?: TranslateFn;
  /** How a stored date or instant is shown. As stored when left out. */
  date?: (value: string) => string;
}

/**
 * Headings a generated report must always show. Empty lists still appear so a
 * required section cannot disappear from the page, CSV, or PDF.
 */
export function snapshotSections(
  snapshot: Record<string, unknown>,
  { t = english, date = (value) => value }: SnapshotViewOptions = {},
): SnapshotSection[] {
  const when = (value: unknown) => (text(value) ? date(text(value)) : "");
  const project = (snapshot.project ?? null) as Record<string, unknown> | null;
  const progress = (snapshot.progress ?? null) as Record<string, unknown> | null;
  const upcoming = (snapshot.upcoming ?? null) as Record<string, unknown> | null;

  if (project) {
    return [
      {
        title: t("reports.sections.outcome"),
        rows: project.outcome ? [{ primary: text(project.outcome) }] : [],
      },
      {
        title: t("reports.sections.health"),
        rows: project.health
          ? [{
              primary: codeLabel(t, "reports.health", project.health),
              secondary: text(project.health_reason) || undefined,
            }]
          : [],
      },
      {
        title: t("reports.sections.progress"),
        rows: progress
          ? [{
              primary: t("reports.rows.percent", { percent: text(progress.percent) }),
              secondary: t("reports.rows.tasksOf", {
                completed: text(progress.completed),
                total: text(progress.total),
              }),
            }]
          : [],
      },
      {
        title: t("reports.sections.milestones"),
        rows: asRows(snapshot.milestones, (row) => ({
          primary: text(row.name),
          secondary: t("reports.rows.milestone", {
            state: row.completed_at ? t("reports.rows.completed") : t("reports.rows.open"),
            date: when(row.due_date),
          }),
        })),
      },
      {
        title: t("reports.sections.blockers"),
        rows: asRows(snapshot.blockers, (row) => ({
          primary: text(row.title),
          secondary: text(row.reason) || undefined,
        })),
      },
      {
        title: t("reports.sections.decisions"),
        rows: asRows(snapshot.decisions, (row) => ({
          primary: text(row.title),
          secondary: row.decided_at
            ? t("reports.rows.decided", { date: when(row.decided_at) })
            : undefined,
        })),
      },
      {
        title: t("reports.sections.nextSteps"),
        rows: snapshot.next_steps ? [{ primary: text(snapshot.next_steps) }] : [],
      },
      {
        title: t("reports.sections.recentActivity"),
        rows: asRows(snapshot.activity, (row) => ({
          primary: text(row.summary),
          secondary: when(row.created_at) || undefined,
        })),
      },
    ];
  }

  return [
    {
      title: t("reports.sections.activeProjects"),
      rows: asRows(snapshot.projects, (row) => ({
        primary: text(row.name),
        secondary: [codeLabel(t, "reports.stage", row.stage), codeLabel(t, "reports.health", row.health)]
          .filter(Boolean)
          .join(" · "),
      })),
    },
    {
      title: t("reports.sections.events"),
      rows: asRows(snapshot.events, (row) => ({
        primary: text(row.name),
        secondary: when(row.starts_at) || undefined,
      })),
    },
    {
      title: t("reports.sections.outcomes"),
      rows: asRows(snapshot.outcomes, (row) => ({
        primary: text(row.name),
        secondary: t("reports.rows.outcome", {
          latest: text(row.latest) || "—",
          unit: text(row.unit),
          target: text(row.target) || "—",
        }),
      })),
    },
    {
      title: t("reports.sections.risks"),
      rows: asRows(snapshot.risks, (row) => ({
        primary: text(row.title),
        secondary: codeLabel(t, "reports.riskStatus", row.status) || undefined,
      })),
    },
    {
      title: t("reports.sections.people"),
      rows: asRows(snapshot.people, (row) => ({
        primary: text(row.name),
        secondary: text(row.role) || undefined,
      })),
    },
    {
      title: t("reports.sections.upcoming"),
      rows: [
        ...asRows(upcoming?.milestones, (row) => ({
          primary: text(row.name),
          secondary: t("reports.rows.upcomingMilestone", { date: when(row.due_date) }),
        })),
        ...asRows(upcoming?.events, (row) => ({
          primary: text(row.name),
          secondary: t("reports.rows.upcomingEvent", { date: when(row.starts_at) }),
        })),
        ...asRows(upcoming?.meetings, (row) => ({
          primary: text(row.title),
          secondary: t("reports.rows.upcomingMeeting", { date: when(row.starts_at) }),
        })),
      ],
    },
  ];
}
