import type { Metadata } from "next";
import { Download, FileArchive } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { RequestExportDialog } from "@/features/exports/components/request-export-dialog";
import { hoursUntilExpiry, isDownloadable } from "@/features/exports/schemas";
import type { ExportStatus } from "@/features/exports/schemas";
import { getExports } from "@/features/exports/services/export.queries";
import { requireAdminAal2 } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFormatters, getLocale, getT } from "@/lib/i18n/server";
import type { Formatters } from "@/lib/i18n/format";
import type { TranslateFn } from "@/lib/i18n/translate";
import { labelOr } from "@/features/admin/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("admin.exports.metaTitle") };
}
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ExportStatus, "success" | "info" | "danger" | "neutral"> = {
  queued: "info",
  running: "info",
  ready: "success",
  failed: "danger",
  expired: "neutral",
};

function formatSize(bytes: number | null, t: TranslateFn, format: Formatters): string {
  if (!bytes) return "—";
  if (bytes < 1024) return t("admin.exports.units.bytes", { n: format.number(bytes) });
  if (bytes < 1024 * 1024) {
    return t("admin.exports.units.kb", { n: format.number(Math.round(bytes / 1024)) });
  }
  return t("admin.exports.units.mb", {
    n: format.number(bytes / (1024 * 1024), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
  });
}

/**
 * Admin → Exports.
 *
 * The log is as important as the button. An export is a copy of the
 * organization's most sensitive data sitting outside every row-level policy
 * that normally protects it, so this page is built to answer the questions
 * asked afterwards: what was taken, by whom, about whom, and how many times it
 * was fetched before it expired.
 */
export default async function AdminExportsPage() {
  await requireAdminAal2();
  const t = await getT();
  const format = await getFormatters();
  const locale = await getLocale();
  const now = new Date();

  const supabase = await createSupabaseServerClient();
  const [rows, { data: members }] = await Promise.all([
    getExports(100),
    supabase
      .from("organization_membership")
      .select("user_id, status, user_profile:user_id(id, full_name)")
      .eq("status", "active"),
  ]);

  type MemberRow = { user_profile: { id: string; full_name: string } | null };
  const people = ((members ?? []) as unknown as MemberRow[])
    .filter((m) => m.user_profile)
    .map((m) => ({ value: m.user_profile!.id, label: m.user_profile!.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow={t("admin.eyebrow")}
        title={t("admin.exports.title")}
        description={t("admin.exports.description")}
        actions={<RequestExportDialog people={people} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileArchive />}
          title={t("admin.exports.emptyTitle")}
          description={t("admin.exports.emptyDescription")}
        />
      ) : (
        <ul className="card divide-y divide-line">
          {rows.map((row) => {
            const downloadable = isDownloadable(
              { status: row.status, expires_at: row.expires_at },
              now,
            );
            const hours = hoursUntilExpiry(row.expires_at, now);

            return (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="min-w-0 flex-1 text-[13.5px] font-medium">
                    {labelOr(t, `admin.exports.kinds.${row.kind}`, row.kind)}
                    {row.subject ? (
                      <span className="font-normal text-muted">
                        {" "}
                        — {row.subject.full_name}
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={STATUS_TONE[row.status]}>
                    {t(`admin.exports.statuses.${row.status}`)}
                  </Badge>
                  {downloadable ? (
                    <a
                      href={`/api/exports/${row.id}/download`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-soft"
                    >
                      <Download className="size-4" aria-hidden />
                      {t("admin.exports.download")}
                    </a>
                  ) : null}
                </div>

                <p className="meta mt-0.5">
                  {row.requester?.full_name ?? t("admin.exports.someone")} ·{" "}
                  {format.relative(row.created_at)}
                  {row.row_count !== null
                    ? t("admin.exports.rows", { count: format.number(row.row_count) })
                    : ""}
                  {row.byte_size ? ` · ${formatSize(row.byte_size, t, format)}` : ""}
                </p>

                <p className="meta">{t(`admin.exports.help.${row.status}`)}</p>

                {row.status === "ready" ? (
                  <p className="meta">
                    {hours > 0
                      ? t(hours === 1 ? "admin.exports.expiresOne" : "admin.exports.expiresOther", {
                          hours,
                          when: format.dateTime(row.expires_at),
                        })
                      : t("admin.exports.pastExpiry")}
                  </p>
                ) : null}

                {row.download_count > 0 ? (
                  <p className="meta">
                    {t(
                      row.download_count === 1
                        ? "admin.exports.downloadedOne"
                        : "admin.exports.downloadedOther",
                      {
                        count: row.download_count,
                        last: row.downloaded_at
                          ? t("admin.exports.lastDownload", {
                              when: format.relative(row.downloaded_at),
                            })
                          : "",
                      },
                    )}
                  </p>
                ) : null}

                {row.error ? (
                  <p className="mt-1 text-[12.5px] text-danger-fg">{row.error}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="meta mt-6 max-w-2xl">
        {t("admin.exports.footer")}
      </p>
    </div>
  );
}
