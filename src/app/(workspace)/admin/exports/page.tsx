import type { Metadata } from "next";
import { Download, FileArchive } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { RequestExportDialog } from "@/features/exports/components/request-export-dialog";
import {
  EXPORT_KIND_LABELS,
  EXPORT_STATUS_LABELS,
  hoursUntilExpiry,
  isDownloadable,
} from "@/features/exports/schemas";
import type { ExportStatus } from "@/features/exports/schemas";
import { getExports } from "@/features/exports/services/export.queries";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Exports" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ExportStatus, "success" | "info" | "danger" | "neutral"> = {
  queued: "info",
  running: "info",
  ready: "success",
  failed: "danger",
  expired: "neutral",
};

const STATUS_HELP: Record<ExportStatus, string> = {
  queued: "Waiting for the next run, within five minutes.",
  running: "Being built now.",
  ready: "Downloadable until it expires.",
  failed: "Nothing was produced. The reason is below.",
  expired: "The file has been deleted. The record stays.",
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  await requireAdmin();
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
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div>
      <AdminNav />
      <PageHeader
        eyebrow="Administration"
        title="Data exports"
        description="Built in the background, kept in a private bucket, and deleted seven days after they are made. Every request and every download is recorded."
        actions={<RequestExportDialog people={people} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileArchive />}
          title="No exports yet"
          description="Request one when a funder audit, a data subject access request, or a move to another system calls for it."
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
                    {EXPORT_KIND_LABELS[row.kind] ?? row.kind}
                    {row.subject ? (
                      <span className="font-normal text-muted">
                        {" "}
                        — {row.subject.full_name}
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={STATUS_TONE[row.status]}>
                    {EXPORT_STATUS_LABELS[row.status]}
                  </Badge>
                  {downloadable ? (
                    <a
                      href={`/api/exports/${row.id}/download`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-(--radius-sm) border border-line bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-soft"
                    >
                      <Download className="size-4" aria-hidden />
                      Download
                    </a>
                  ) : null}
                </div>

                <p className="meta mt-0.5">
                  {row.requester?.full_name ?? "Someone"} ·{" "}
                  {relativeTime(row.created_at)}
                  {row.row_count !== null ? ` · ${row.row_count} rows` : ""}
                  {row.byte_size ? ` · ${formatSize(row.byte_size)}` : ""}
                </p>

                <p className="meta">{STATUS_HELP[row.status]}</p>

                {row.status === "ready" ? (
                  <p className="meta">
                    {hours > 0
                      ? `Expires in ${hours} ${hours === 1 ? "hour" : "hours"} (${formatDateTime(row.expires_at)}).`
                      : "Past its expiry date — the next sweep will delete the file."}
                  </p>
                ) : null}

                {row.download_count > 0 ? (
                  <p className="meta">
                    Downloaded {row.download_count}{" "}
                    {row.download_count === 1 ? "time" : "times"}
                    {row.downloaded_at ? `, last ${relativeTime(row.downloaded_at)}` : ""}.
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
        Exports live in a private bucket with no access policies at all — the
        only way to reach one is a link signed for two minutes after this page
        has checked who you are. The record outlives the file on purpose: after
        an incident, the question is who took a copy, and that answer should
        survive the copy being deleted.
      </p>
    </div>
  );
}
