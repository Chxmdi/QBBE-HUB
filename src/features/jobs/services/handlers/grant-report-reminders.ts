import { createNotifications, type NotificationDraft } from "../notify";
import type { JobContext, JobResult } from "../runner";

/**
 * Reminds people about reports owed to grant funders (#156).
 *
 * Who: the grant's responsible person; when none is named (or they are no
 * longer active staff), the organization's active owners and admins.
 *
 * When: once when the report comes within 14 days of its due date, once on
 * the due date, then weekly while it stays overdue. The last reminder sent is
 * kept on the report row, so a day the job did not run is caught up the next
 * day instead of silently skipped, and a changed due date starts over (the
 * database clears the marker).
 *
 * Read in two windows, soon-due and overdue, each with its own budget, for
 * the same reason as due-date-reminders: a backlog of old overdue reports must
 * not crowd out the one due this week.
 */

const UPCOMING_DAYS = 14;
const OVERDUE_REPEAT_DAYS = 7;

interface ReportRow {
  id: string;
  organization_id: string;
  grant_id: string;
  title: string;
  due_on: string;
  last_reminder_kind: "upcoming" | "due" | "overdue" | null;
  last_reminded_at: string | null;
  grant: { title: string; status: string; responsible_user_id: string | null } | null;
}

type Kind = "upcoming" | "due" | "overdue";

function dateInZone(timezone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Which reminder, if any, a report is owed today. Exported for tests. */
export function reminderFor(
  report: Pick<ReportRow, "due_on" | "last_reminder_kind" | "last_reminded_at">,
  today: string,
  now: Date,
): Kind | null {
  const daysLeft = daysBetween(today, report.due_on);
  if (daysLeft > UPCOMING_DAYS) return null;
  if (daysLeft > 0) return report.last_reminder_kind === null ? "upcoming" : null;
  if (daysLeft === 0) {
    return report.last_reminder_kind === "due" || report.last_reminder_kind === "overdue" ? null : "due";
  }
  if (report.last_reminder_kind !== "overdue" || !report.last_reminded_at) return "overdue";
  const since = (now.getTime() - Date.parse(report.last_reminded_at)) / 86_400_000;
  return since >= OVERDUE_REPEAT_DAYS - 0.5 ? "overdue" : null;
}

export async function grantReportReminders({ db, definition, now }: JobContext): Promise<JobResult> {
  const { data: organizations } = await db.from("organization").select("id, timezone");
  const zones = new Map(
    ((organizations ?? []) as { id: string; timezone: string | null }[]).map((row) => [
      row.id,
      row.timezone || "America/Toronto",
    ]),
  );

  const nowDate = now.toISOString().slice(0, 10);
  const soonFloor = addDays(nowDate, -1);
  const horizon = addDays(nowDate, UPCOMING_DAYS + 1);
  const select =
    "id, organization_id, grant_id, title, due_on, last_reminder_kind, last_reminded_at, grant:grant_id(title, status, responsible_user_id)";

  const [{ data: soon, error }, { data: overdue, error: overdueError }] = await Promise.all([
    db
      .from("grant_report")
      .select(select)
      .is("submitted_on", null)
      .gte("due_on", soonFloor)
      .lte("due_on", horizon)
      .order("due_on", { ascending: true })
      .limit(definition.batch_size),
    db
      .from("grant_report")
      .select(select)
      .is("submitted_on", null)
      .lt("due_on", soonFloor)
      .order("due_on", { ascending: false })
      .limit(definition.batch_size),
  ]);
  if (error) throw new Error(`could not load grant reports: ${error.message}`);
  if (overdueError) throw new Error(`could not load overdue grant reports: ${overdueError.message}`);

  const reports = [...(soon ?? []), ...(overdue ?? [])] as unknown as ReportRow[];
  const due: { report: ReportRow; kind: Kind; today: string }[] = [];
  for (const report of reports) {
    if (!report.grant || report.grant.status !== "active") continue;
    const today = dateInZone(zones.get(report.organization_id) ?? "America/Toronto", now);
    const kind = reminderFor(report, today, now);
    if (kind) due.push({ report, kind, today });
  }
  if (due.length === 0) {
    return { processed: 0, failed: 0, metadata: { scanned: reports.length } };
  }

  // Active staff per organization, and its owners/admins as the fallback.
  const orgIds = [...new Set(due.map((d) => d.report.organization_id))];
  const { data: members, error: memberError } = await db
    .from("organization_membership")
    .select("organization_id, user_id, role")
    .in("organization_id", orgIds)
    .eq("status", "active")
    .in("role", ["owner", "admin", "staff"]);
  if (memberError) throw new Error(`could not load members: ${memberError.message}`);
  const staff = new Set<string>();
  const admins = new Map<string, string[]>();
  for (const m of (members ?? []) as { organization_id: string; user_id: string; role: string }[]) {
    staff.add(`${m.organization_id}:${m.user_id}`);
    if (m.role === "owner" || m.role === "admin") {
      admins.set(m.organization_id, [...(admins.get(m.organization_id) ?? []), m.user_id]);
    }
  }

  const drafts: NotificationDraft[] = [];
  for (const { report, kind, today } of due) {
    const responsible = report.grant?.responsible_user_id;
    const recipients =
      responsible && staff.has(`${report.organization_id}:${responsible}`)
        ? [responsible]
        : (admins.get(report.organization_id) ?? []);
    const label = kind === "overdue" ? "Overdue" : kind === "due" ? "Due today" : "Coming up";
    for (const userId of recipients) {
      drafts.push({
        user_id: userId,
        organization_id: report.organization_id,
        category: "due_date",
        title: `${label}: ${report.title} for ${report.grant?.title ?? "a grant"}`,
        body:
          kind === "overdue"
            ? `This grant report was due ${report.due_on}. Submit it to the funder, then mark it submitted.`
            : `Grant report due ${report.due_on}.`,
        source_type: "grant_report",
        source_id: report.id,
        link: `/finance/gifts/grants/${report.grant_id}`,
        urgency: kind === "upcoming" ? "normal" : "high",
        dedupe_key: `grant-report:${report.id}:${kind}:${today}`,
        reason: "grant report due",
        context: report.grant?.title ?? report.title,
        due_on: report.due_on,
      });
    }
  }

  const created = await createNotifications(db, drafts);

  // Remember what was sent, report by report.
  const stamp = now.toISOString();
  let failed = 0;
  for (const { report, kind } of due) {
    const { error: markError } = await db
      .from("grant_report")
      .update({ last_reminder_kind: kind, last_reminded_at: stamp })
      .eq("id", report.id);
    if (markError) failed += 1;
  }

  return {
    processed: due.length,
    failed,
    metadata: {
      scanned: reports.length,
      notifications: created,
      soonTruncated: (soon ?? []).length >= definition.batch_size,
      overdueTruncated: (overdue ?? []).length >= definition.batch_size,
    },
  };
}
