import { Badge } from "@/components/ui/badge";
import type { ReportVersionRow } from "@/features/reports/services/report.queries";
import { getFormatters, getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * Version notes the Hub writes itself are stored in English; show them in the
 * reader's language. A note somebody typed is shown as written.
 */
function versionNote(note: string, t: TranslateFn): string {
  if (note === "First generation.") return t("reports.versionNotes.first");
  if (note === "Regenerated from live data.") return t("reports.versionNotes.regenerated");
  return note;
}

/**
 * The trail: every version, and what was decided about each.
 *
 * This is the part a funder or a trustee asks for — not "was it approved" but
 * "approved when, by whom, and against which figures". A single version is
 * still worth showing, because it says the numbers have not moved since.
 */
export async function VersionHistory({
  versions,
  shownVersion,
}: {
  versions: ReportVersionRow[];
  shownVersion: number | null;
}) {
  if (versions.length === 0) return null;
  const [t, format] = await Promise.all([getT(), getFormatters()]);

  return (
    <section aria-labelledby="report-versions" className="mt-8">
      <h2 id="report-versions" className="section-heading mb-2">
        {t("reports.versions.heading")}
        <span className="ml-2 font-normal text-muted">{versions.length}</span>
      </h2>
      <ol className="card divide-y divide-line">
        {versions.map((version) => (
          <li key={version.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium tabular-nums">
                {t("reports.versions.version", { number: version.version_number })}
              </span>
              {version.version_number === shownVersion ? (
                <Badge tone="info">{t("reports.versions.shownAbove")}</Badge>
              ) : null}
              {version.approval ? (
                <Badge
                  tone={version.approval.decision === "approved" ? "success" : "danger"}
                >
                  {version.approval.decision === "approved"
                    ? t("reports.versions.approved")
                    : t("reports.versions.sentBack")}
                </Badge>
              ) : (
                <Badge tone="neutral">{t("reports.versions.noDecision")}</Badge>
              )}
            </div>
            <p className="meta mt-0.5">
              {format.dateTime(version.generated_at)}
              {version.generated_by_name ? ` · ${version.generated_by_name}` : ""}
              {version.note ? ` · ${versionNote(version.note, t)}` : ""}
            </p>
            {version.approval ? (
              <p className="meta">
                {version.approval.decision === "approved"
                  ? t("reports.versions.approved")
                  : t("reports.versions.sentBack")}{" "}
                {format.dateTime(version.approval.decided_at)}
                {version.approval.decided_by_name
                  ? t("reports.versions.byName", { name: version.approval.decided_by_name })
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
