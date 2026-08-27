import type { Metadata } from "next";
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
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ document?: string }>;
}) {
  const session = await requireSession();
  const { document: highlightId = null } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const [{ data: documents }, { data: projects }, { data: programs }] =
    await Promise.all([
      supabase
        .from("document")
        .select(
          "id, title, description, kind, mime_type, size_bytes, visibility, created_at, " +
            "owner:owner_id(full_name), project:project_id(id, name), program:program_id(id, name)",
        )
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("project")
        .select("id, name")
        .is("archived_at", null)
        .order("name"),
      supabase.from("program").select("id, name").eq("status", "active").order("name"),
    ]);

  const rows = (documents ?? []) as unknown as DocumentRow[];

  return (
    <div>
      <PageHeader
        eyebrow="Files & resources"
        title="Documents"
        description="Operational files and links, each showing the program or project it belongs to. Files are stored privately and opened through short-lived links."
        actions={
          <DocumentUploadDialog
            projects={(projects ?? []).map((p) => ({ id: p.id, label: p.name }))}
            programs={(programs ?? []).map((p) => ({ id: p.id, label: p.name }))}
          />
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title="No resources yet"
          description="Upload a file or link a QBBE-controlled Drive document, then attach it to the program or project it supports."
        />
      ) : (
        <>
          <DocumentList
            documents={rows}
            canManage={session.isStaff}
            highlightId={highlightId}
          />
          <DeepLinkScroll
            targetId={highlightId ? `document-${highlightId}` : null}
          />
        </>
      )}
    </div>
  );
}
