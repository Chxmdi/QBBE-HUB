import { Badge } from "@/components/ui/badge";
import type { ReportVersionRow } from "@/features/reports/services/report.queries";
import { formatDateTime } from "@/lib/utils";

/**
 * The trail: every version, and what was decided about each.
 *
 * This is the part a funder or a trustee asks for — not "was it approved" but
 * "approved when, by whom, and against which figures". A single version is
 * still worth showing, because it says the numbers have not moved since.
 */
export function VersionHistory({
  versions,
  shownVersion,
}: {
  versions: ReportVersionRow[];
  shownVersion: number | null;
}) {
  if (versions.length === 0) return null;

  return (
    <section aria-labelledby="report-versions" className="mt-8">
      <h2 id="report-versions" className="section-heading mb-2">
        Versions
        <span className="ml-2 font-normal text-muted">{versions.length}</span>
      </h2>
      <ol className="card divide-y divide-line">
        {versions.map((version) => (
          <li key={version.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium tabular-nums">
                Version {version.version_number}
              </span>
              {version.version_number === shownVersion ? (
                <Badge tone="info">Shown above</Badge>
              ) : null}
              {version.approval ? (
                <Badge
                  tone={version.approval.decision === "approved" ? "success" : "danger"}
                >
                  {version.approval.decision === "approved"
                    ? "Approved"
                    : "Sent back"}
                </Badge>
              ) : (
                <Badge tone="neutral">No decision</Badge>
              )}
            </div>
            <p className="meta mt-0.5">
              {formatDateTime(version.generated_at)}
              {version.generated_by_name ? ` · ${version.generated_by_name}` : ""}
              {version.note ? ` · ${version.note}` : ""}
            </p>
            {version.approval ? (
              <p className="meta">
                {version.approval.decision === "approved" ? "Approved" : "Sent back"}{" "}
                {formatDateTime(version.approval.decided_at)}
                {version.approval.decided_by_name
                  ? ` by ${version.approval.decided_by_name}`
                  : ""}
                {version.approval.note ? ` — ${version.approval.note}` : ""}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
