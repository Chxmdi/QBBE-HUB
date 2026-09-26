import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import {
  AcknowledgeButton,
  DocumentDetailsForm,
  NewVersionDialog,
  VersionHistory,
  type VersionRow,
} from "@/features/documents/components/document-library-panels";
import { folderLabel, type LibraryFolder } from "@/features/documents/services/library";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { formatDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Document" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CurrentRow extends VersionRow {
  title: string;
  description: string | null;
  owner_id: string | null;
  visibility: string;
  tags: string[];
  requires_acknowledgement: boolean;
  project_id: string | null;
  program_id: string | null;
  meeting_id: string | null;
  event_id: string | null;
  crm_organization_id: string | null;
  folder: LibraryFolder | null;
}

interface AcknowledgementStatusRow {
  user_id: string;
  full_name: string | null;
  role: string;
  acknowledged_at: string | null;
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createSupabasePageClient();

  // Row-level security decides whether this exists for the reader at all.
  const { data: linked } = await supabase
    .from("document")
    .select("id, series_id")
    .eq("id", id)
    .maybeSingle();
  if (!linked) notFound();

  const [{ data: versionRows }, { data: folderRows }] = await Promise.all([
    supabase
      .from("document")
      .select(
        "id, version_number, kind, scan_status, size_bytes, created_at, superseded_at, archived_at, " +
          "title, description, owner_id, visibility, tags, requires_acknowledgement, " +
          "project_id, program_id, meeting_id, event_id, crm_organization_id, " +
          "creator:created_by(full_name), folder:folder_id(id, category, name, visibility)",
      )
      .eq("series_id", linked.series_id as string)
      .order("version_number", { ascending: false }),
    supabase
      .from("document_folder")
      .select("id, category, name, visibility")
      .eq("organization_id", session.organizationId)
      .is("archived_at", null)
      .order("name"),
  ]);

  const versions = (versionRows ?? []) as unknown as CurrentRow[];
  // The newest version the reader can see stands for the document.
  const current = versions.find((v) => v.superseded_at === null) ?? versions[0];
  if (!current) notFound();
  const isCurrent = current.superseded_at === null;
  const folders = (folderRows ?? []) as LibraryFolder[];
  const canManage = session.isStaff || current.owner_id === session.userId;
  const unattached =
    !current.project_id &&
    !current.program_id &&
    !current.meeting_id &&
    !current.event_id &&
    !current.crm_organization_id;
  const canRequireReading = session.isStaff && unattached && current.visibility === "organization";

  let acknowledgedAt: string | null = null;
  if (current.requires_acknowledgement && isCurrent) {
    const { data: mine } = await supabase
      .from("document_acknowledgement")
      .select("acknowledged_at")
      .eq("document_id", current.id)
      .eq("user_id", session.userId)
      .maybeSingle();
    acknowledgedAt = (mine?.acknowledged_at as string | undefined) ?? null;
  }

  // Who has and has not read it: administrators only, and the database also
  // requires a completed MFA sign-in, so a refusal here is expected for an
  // administrator who has not stepped up yet.
  let report: AcknowledgementStatusRow[] | null = null;
  let reportUnavailable = false;
  if (session.isAdmin && current.requires_acknowledgement && isCurrent) {
    const { data, error } = await supabase.rpc("document_acknowledgement_status", {
      p_document: current.id,
    });
    if (error) reportUnavailable = true;
    else report = (data ?? []) as AcknowledgementStatusRow[];
  }
  const readCount = report?.filter((r) => r.acknowledged_at).length ?? 0;

  return (
    <div>
      <Link
        href="/documents"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-fg hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Documents
      </Link>
      <PageHeader
        eyebrow={current.folder ? folderLabel(current.folder) : "Documents"}
        title={current.title}
        description={current.description ?? undefined}
        actions={
          canManage && isCurrent && !current.archived_at ? (
            <NewVersionDialog currentId={current.id} currentKind={current.kind} />
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={current.visibility === "organization" ? "neutral" : "accent"}>
          {current.visibility === "organization" ? "All members" : "Restricted"}
        </Badge>
        {current.folder?.visibility === "staff" ? (
          <Badge tone="accent">Staff-only folder</Badge>
        ) : null}
        {current.requires_acknowledgement ? <Badge tone="info">Required reading</Badge> : null}
        {current.tags.map((tag) => (
          <Link
            key={tag}
            href={`/documents?tag=${encodeURIComponent(tag)}`}
            className="rounded-full bg-surface-soft px-2 py-0.5 text-[12px] text-muted hover:text-brand-fg"
          >
            #{tag}
          </Link>
        ))}
      </div>

      {current.requires_acknowledgement && isCurrent ? (
        <section
          aria-labelledby="reading-heading"
          className="mb-6 rounded-(--radius-md) border border-line p-4"
        >
          <h2 id="reading-heading" className="section-heading mb-2">
            Required reading
          </h2>
          {acknowledgedAt ? (
            <p className="text-sm">
              You confirmed you read version {current.version_number} on{" "}
              {formatDate(acknowledgedAt)}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">
                Please read version {current.version_number}, then confirm.
              </p>
              <AcknowledgeButton documentId={current.id} />
            </div>
          )}

          {report ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-medium">
                {readCount} of {report.length} have confirmed
              </h3>
              <table className="w-full text-sm" aria-label="Who has read this">
                <thead>
                  <tr className="text-left text-muted">
                    <th className="py-1 font-medium">Member</th>
                    <th className="py-1 font-medium">Role</th>
                    <th className="py-1 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.user_id} className="border-t border-line">
                      <td className="py-1.5">{r.full_name ?? "—"}</td>
                      <td className="py-1.5 text-muted">{r.role.replace("_", " ")}</td>
                      <td className="py-1.5">
                        {r.acknowledged_at ? (
                          <Badge tone="success">Read {formatDate(r.acknowledged_at)}</Badge>
                        ) : (
                          <Badge tone="warning">Not yet</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : reportUnavailable ? (
            <p className="meta mt-3">
              Complete multi-factor sign-in to see who has and hasn&apos;t read this.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="versions-heading" className="mb-6">
        <h2 id="versions-heading" className="section-heading mb-2">
          Versions
        </h2>
        <VersionHistory versions={versions} linkedId={id} />
      </section>

      {canManage && isCurrent ? (
        <section aria-labelledby="details-heading" className="mb-6">
          <h2 id="details-heading" className="section-heading mb-2">
            Filing
          </h2>
          <DocumentDetailsForm
            documentId={current.id}
            folders={folders}
            folderId={current.folder?.id ?? null}
            tags={current.tags}
            requiresAcknowledgement={current.requires_acknowledgement}
            canRequireReading={canRequireReading}
          />
        </section>
      ) : null}
    </div>
  );
}
