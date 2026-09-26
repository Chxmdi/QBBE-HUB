import type { Metadata } from "next";
import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DocumentList,
  type DocumentRow,
} from "@/features/documents/components/document-list";
import { DocumentUploadDialog } from "@/features/documents/components/document-upload-dialog";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ document?: string; archived?: string }>;
}) {
  const session = await requireSession();
  const { document: highlightId = null, archived } = await searchParams;
  const showingArchived = archived === "1";
  const supabase = await createSupabasePageClient();

  const [
    { data: documents },
    { data: projects },
    { data: programs },
    { data: approvedHosts },
  ] = await Promise.all([
      (() => {
        const query = supabase
          .from("document")
          .select(
            "id, title, description, kind, mime_type, size_bytes, scan_status, visibility, created_at, " +
              "owner:owner_id(full_name), project:project_id(id, name), program:program_id(id, name)",
          );
        return (showingArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null))
          .order("created_at", { ascending: false })
          .limit(200);
      })(),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase.from("program").select("id, name").eq("status", "active").order("name"),
      // What the link form is allowed to accept (P0-FIL-01). Read here so the
      // form can name the approved sources rather than refusing afterwards; the
      // database is still what enforces it.
      supabase
        .from("approved_document_host")
        .select("host, label")
        .eq("organization_id", session.organizationId)
        .order("host"),
    ]);

  const rows = (documents ?? []) as unknown as DocumentRow[];

  return (
    <div>
      <PageHeader
        eyebrow="Files & resources"
        title="Documents"
        description="Operational files and links, each showing the program or project it belongs to. Files are stored privately and opened through short-lived links."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={showingArchived ? "/documents" : "/documents?archived=1"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {showingArchived ? "Active documents" : "Archived"}
            </Link>
            <DocumentUploadDialog
              projects={(projects ?? []).map((p) => ({ id: p.id, label: p.name }))}
              programs={(programs ?? []).map((p) => ({ id: p.id, label: p.name }))}
              approvedHosts={(approvedHosts ?? []).map((h) => ({
                host: h.host as string,
                label: (h.label as string) || (h.host as string),
              }))}
            />
          </div>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
        title={showingArchived ? "No archived documents" : "No resources yet"}
        description={
          showingArchived
            ? "Archived documents stay here until someone restores them."
            : "Upload a file or link a QBBE-controlled Drive document, then attach it to the program or project it supports."
        }
        />
      ) : (
        <>
          <DocumentList
            documents={rows}
            canManage={session.isStaff}
            highlightId={highlightId}
            archived={showingArchived}
          />
          <DeepLinkScroll
            targetId={highlightId ? `document-${highlightId}` : null}
          />
        </>
      )}
    </div>
  );
}
