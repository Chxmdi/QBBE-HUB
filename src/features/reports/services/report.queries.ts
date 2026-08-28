import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reading a report's history.
 *
 * The rule every reader here exists to serve: an approved report shows the
 * version that was approved, not the latest one. Otherwise regenerating a
 * report would silently change what a funder was sent, which is the whole
 * problem versions were added to solve.
 */

export interface ReportApprovalRow {
  id: string;
  decision: "approved" | "rejected";
  note: string | null;
  decided_at: string;
  decided_by_name: string | null;
}

export interface ReportVersionRow {
  id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  note: string | null;
  generated_at: string;
  generated_by_name: string | null;
  approval: ReportApprovalRow | null;
}

interface RawVersion {
  id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  note: string | null;
  generated_at: string;
  author: { full_name: string } | null;
  approvals: {
    id: string;
    decision: "approved" | "rejected";
    note: string | null;
    decided_at: string;
    decider: { full_name: string } | null;
  }[];
}

const SELECT =
  "id, version_number, snapshot, note, generated_at, " +
  "author:generated_by(full_name), " +
  "approvals:report_approval(id, decision, note, decided_at, decider:decided_by(full_name))";

/** Newest version first — the history is read from the top. */
export async function getReportVersions(
  reportId: string,
): Promise<ReportVersionRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("report_version")
    .select(SELECT)
    .eq("report_id", reportId)
    .order("version_number", { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown as RawVersion[]).map((row) => {
    // One approval per version is a unique index, so the array holds at most
    // one row; taking the first is exact rather than a guess.
    const approval = row.approvals?.[0] ?? null;
    return {
      id: row.id,
      version_number: row.version_number,
      snapshot: row.snapshot,
      note: row.note,
      generated_at: row.generated_at,
      generated_by_name: row.author?.full_name ?? null,
      approval: approval
        ? {
            id: approval.id,
            decision: approval.decision,
            note: approval.note,
            decided_at: approval.decided_at,
            decided_by_name: approval.decider?.full_name ?? null,
          }
        : null,
    };
  });
}

/**
 * The version a reader should be shown: the approved one if there is one,
 * otherwise the latest. Used by the screen, the CSV and the PDF alike, so all
 * three agree about what "this report says" means.
 */
export function versionToShow(
  versions: ReportVersionRow[],
): ReportVersionRow | null {
  const approved = versions.find((v) => v.approval?.decision === "approved");
  return approved ?? versions[0] ?? null;
}

/** Convenience for the export routes, which need only the numbers. */
export async function getReportSnapshot(
  reportId: string,
): Promise<{ snapshot: Record<string, unknown>; version: number } | null> {
  const versions = await getReportVersions(reportId);
  const chosen = versionToShow(versions);
  return chosen
    ? { snapshot: chosen.snapshot, version: chosen.version_number }
    : null;
}
