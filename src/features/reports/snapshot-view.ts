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

/**
 * Headings a generated report must always show. Empty lists still appear so a
 * required section cannot disappear from the page, CSV, or PDF.
 */
export function snapshotSections(snapshot: Record<string, unknown>): SnapshotSection[] {
  const project = (snapshot.project ?? null) as Record<string, unknown> | null;
  const progress = (snapshot.progress ?? null) as Record<string, unknown> | null;
  const upcoming = (snapshot.upcoming ?? null) as Record<string, unknown> | null;

  if (project) {
    return [
      {
        title: "Outcome",
        rows: project.outcome ? [{ primary: text(project.outcome) }] : [],
      },
      {
        title: "Health",
        rows: project.health
          ? [{
              primary: text(project.health).replace(/_/g, " "),
              secondary: text(project.health_reason) || undefined,
            }]
          : [],
      },
      {
        title: "Progress",
        rows: progress
          ? [{
              primary: `${text(progress.percent)}%`,
              secondary: `${text(progress.completed)} of ${text(progress.total)} tasks`,
            }]
          : [],
      },
      {
        title: "Milestones",
        rows: asRows(snapshot.milestones, (row) => ({
          primary: text(row.name),
          secondary: `${row.completed_at ? "Completed" : "Open"} · due ${text(row.due_date)}`,
        })),
      },
      {
        title: "Blockers",
        rows: asRows(snapshot.blockers, (row) => ({
          primary: text(row.title),
          secondary: text(row.reason) || undefined,
        })),
      },
      {
        title: "Decisions",
        rows: asRows(snapshot.decisions, (row) => ({
          primary: text(row.title),
          secondary: row.decided_at ? `Decided ${text(row.decided_at)}` : undefined,
        })),
      },
      {
        title: "Next steps",
        rows: snapshot.next_steps ? [{ primary: text(snapshot.next_steps) }] : [],
      },
      {
        title: "Recent activity",
        rows: asRows(snapshot.activity, (row) => ({
          primary: text(row.summary),
          secondary: text(row.created_at) || undefined,
        })),
      },
    ];
  }

  return [
    {
      title: "Active projects",
      rows: asRows(snapshot.projects, (row) => ({
        primary: text(row.name),
        secondary: [text(row.stage), text(row.health).replace(/_/g, " ")].filter(Boolean).join(" · "),
      })),
    },
    {
      title: "Events",
      rows: asRows(snapshot.events, (row) => ({
        primary: text(row.name),
        secondary: text(row.starts_at) || undefined,
      })),
    },
    {
      title: "Outcomes",
      rows: asRows(snapshot.outcomes, (row) => ({
        primary: text(row.name),
        secondary: `latest ${text(row.latest) || "—"} ${text(row.unit)} · target ${text(row.target) || "—"}`,
      })),
    },
    {
      title: "Risks",
      rows: asRows(snapshot.risks, (row) => ({
        primary: text(row.title),
        secondary: text(row.status) || undefined,
      })),
    },
    {
      title: "People",
      rows: asRows(snapshot.people, (row) => ({
        primary: text(row.name),
        secondary: text(row.role) || undefined,
      })),
    },
    {
      title: "Upcoming commitments",
      rows: [
        ...asRows(upcoming?.milestones, (row) => ({
          primary: text(row.name),
          secondary: `Milestone · ${text(row.due_date)}`,
        })),
        ...asRows(upcoming?.events, (row) => ({
          primary: text(row.name),
          secondary: `Event · ${text(row.starts_at)}`,
        })),
        ...asRows(upcoming?.meetings, (row) => ({
          primary: text(row.title),
          secondary: `Meeting · ${text(row.starts_at)}`,
        })),
      ],
    },
  ];
}
