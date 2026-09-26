import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderOpen, Search } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import {
  DocumentList,
  type DocumentRow,
} from "@/features/documents/components/document-list";
import { DocumentUploadDialog } from "@/features/documents/components/document-upload-dialog";
import { FolderCreateDialog } from "@/features/documents/components/folder-create-dialog";
import {
  folderLabel,
  groupFolders,
  likePattern,
  type LibraryFolder,
} from "@/features/documents/services/library";
import { DeepLinkScroll } from "@/components/shared/deep-link-scroll";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    document?: string;
    archived?: string;
    q?: string;
    folder?: string;
    tag?: string;
    reading?: string;
  }>;
}) {
  const session = await requireSession();
  const {
    document: highlightId = null,
    archived,
    q = "",
    folder = "",
    tag = "",
    reading,
  } = await searchParams;
  const showingArchived = archived === "1";
  const query = q.trim().slice(0, 200);
  const folderId = UUID.test(folder) ? folder : "";
  const tagFilter = tag.trim().toLowerCase().slice(0, 40);
  const requiredOnly = reading === "1";
  const filtering = Boolean(query || folderId || tagFilter || requiredOnly);
  const supabase = await createSupabasePageClient();

  const [
    { data: documents },
    { data: projects },
    { data: programs },
    { data: approvedHosts },
    { data: folderRows },
  ] = await Promise.all([
      (() => {
        // Only the current version of each document is listed; earlier
        // versions are on the document's own page (#147).
        let list = supabase
          .from("document")
          .select(
            "id, title, description, kind, mime_type, size_bytes, scan_status, visibility, created_at, " +
              "tags, version_number, requires_acknowledgement, " +
              "owner:owner_id(full_name), project:project_id(id, name), program:program_id(id, name), " +
              "folder:folder_id(id, category, name, visibility)",
          )
          .is("superseded_at", null);
        list = showingArchived ? list.not("archived_at", "is", null) : list.is("archived_at", null);
        if (folderId) list = list.eq("folder_id", folderId);
        if (tagFilter) list = list.contains("tags", [tagFilter]);
        if (query) list = list.ilike("search_text", likePattern(query));
        if (requiredOnly) list = list.eq("requires_acknowledgement", true);
        return list.order("created_at", { ascending: false }).limit(200);
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
      supabase
        .from("document_folder")
        .select("id, category, name, visibility")
        .eq("organization_id", session.organizationId)
        .is("archived_at", null)
        .order("name"),
    ]);

  const rows = (documents ?? []) as unknown as DocumentRow[];
  const folders = (folderRows ?? []) as LibraryFolder[];
  const activeFolder = folders.find((f) => f.id === folderId) ?? null;

  // A deep link to a version that is not listed here (an earlier version,
  // found through global search) goes to the document's own page instead.
  if (highlightId && UUID.test(highlightId) && !filtering && !rows.some((r) => r.id === highlightId)) {
    const { data: target } = await supabase
      .from("document")
      .select("id, superseded_at")
      .eq("id", highlightId)
      .maybeSingle();
    if (target?.superseded_at) redirect(`/documents/${target.id}`);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Files & resources"
        title="Documents"
        description="The organization's library: files and links filed by folder, with version history and required reading. Files are stored privately and opened through short-lived links."
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={showingArchived ? "/documents" : "/documents?archived=1"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {showingArchived ? "Active documents" : "Archived"}
            </Link>
            {session.isAdmin ? <FolderCreateDialog /> : null}
            <DocumentUploadDialog
              projects={(projects ?? []).map((p) => ({ id: p.id, label: p.name }))}
              programs={(programs ?? []).map((p) => ({ id: p.id, label: p.name }))}
              approvedHosts={(approvedHosts ?? []).map((h) => ({
                host: h.host as string,
                label: (h.label as string) || (h.host as string),
              }))}
              folders={folders}
              defaultFolderId={activeFolder?.id ?? ""}
            />
          </div>
        }
      />

      <form
        method="get"
        action="/documents"
        role="search"
        aria-label="Search documents"
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]"
      >
        {showingArchived ? <input type="hidden" name="archived" value="1" /> : null}
        <div>
          <Label htmlFor="library-q">Search</Label>
          <Input
            id="library-q"
            name="q"
            defaultValue={query}
            maxLength={200}
            placeholder="Title, description or tag"
          />
        </div>
        <div>
          <Label htmlFor="library-folder">Folder</Label>
          <Select id="library-folder" name="folder" defaultValue={activeFolder?.id ?? ""}>
            <option value="">All folders</option>
            {groupFolders(folders).map((group) => (
              <optgroup key={group.category} label={group.label}>
                {group.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="library-tag">Tag</Label>
          <Input id="library-tag" name="tag" defaultValue={tagFilter} maxLength={40} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary">
            <Search className="size-4" aria-hidden />
            Search
          </Button>
          {filtering ? (
            <Link
              href={showingArchived ? "/documents?archived=1" : "/documents"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className="meta mb-3">
        {requiredOnly ? (
          <>
            Showing required reading.{" "}
            <Link href="/documents" className="text-brand-fg hover:underline">
              Show everything
            </Link>
          </>
        ) : (
          <Link href="/documents?reading=1" className="text-brand-fg hover:underline">
            Show required reading
          </Link>
        )}
        {activeFolder ? (
          <span>
            {" "}
            · In {folderLabel(activeFolder)}
            {activeFolder.visibility === "staff" ? " (staff only)" : ""}
          </span>
        ) : null}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title={
            filtering
              ? "No documents match"
              : showingArchived
                ? "No archived documents"
                : "No resources yet"
          }
          description={
            filtering
              ? "Try other words, another folder, or clear the search."
              : showingArchived
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
