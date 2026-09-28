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
import { SearchSnippet } from "@/features/documents/components/search-snippet";
import { requireSession } from "@/lib/auth";
import { createSupabasePageClient } from "@/lib/supabase/page";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("documents.title") };
}
export const dynamic = "force-dynamic";

type SearchHit = {
  kind: "document" | "receipt";
  id: string;
  title: string;
  snippet: string | null;
  matched_inside: boolean;
  version_number: number | null;
  is_current: boolean;
  created_at: string;
  receipt_date: string | null;
};

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
  const t = await getT();

  // Search inside files and receipts (#147). The database returns only what
  // this person may open; receipts are for staff, and only their own unless
  // they review receipts.
  const { data: hitRows } = query
    ? await supabase.rpc("search_library", {
        p_query: query,
        p_include_receipts: session.isStaff && !showingArchived,
        p_include_archived: showingArchived,
        p_limit: 100,
      })
    : { data: [] };
  const hits = (hitRows ?? []) as SearchHit[];
  const snippets: Record<string, string> = {};
  for (const hit of hits) if (hit.snippet) snippets[hit.id] = hit.snippet;
  const insideIds = hits
    .filter((h) => h.kind === "document" && h.matched_inside && h.is_current)
    .map((h) => h.id);
  const earlierMatches = hits.filter((h) => h.kind === "document" && !h.is_current);
  const receiptMatches = hits.filter((h) => h.kind === "receipt");

  // Only the current version of each document is listed; earlier versions
  // are on the document's own page (#147).
  const listQuery = (match: "words" | "inside") => {
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
    if (match === "inside") list = list.in("id", insideIds);
    else if (query) list = list.ilike("search_text", likePattern(query));
    if (requiredOnly) list = list.eq("requires_acknowledgement", true);
    return list.order("created_at", { ascending: false }).limit(200);
  };

  const [
    { data: documents },
    { data: insideDocuments },
    { data: projects },
    { data: programs },
    { data: approvedHosts },
    { data: folderRows },
  ] = await Promise.all([
      listQuery("words"),
      insideIds.length ? listQuery("inside") : Promise.resolve({ data: [] }),
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

  // Title/description/tag matches first, then documents found by their words.
  const byWords = (documents ?? []) as unknown as DocumentRow[];
  const rows = [
    ...byWords,
    ...((insideDocuments ?? []) as unknown as DocumentRow[]).filter(
      (d) => !byWords.some((w) => w.id === d.id),
    ),
  ];
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
        eyebrow={t("documents.eyebrow")}
        title={t("documents.title")}
        description={t("documents.description")}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={showingArchived ? "/documents" : "/documents?archived=1"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {showingArchived ? t("documents.activeDocuments") : t("documents.archived")}
            </Link>
            {session.isStaff ? (
              <Link
                href="/documents/templates"
                className="text-[13px] font-medium text-brand-fg hover:underline"
              >
                {t("documents.templatesLink")}
              </Link>
            ) : null}
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
        aria-label={t("documents.search.aria")}
        className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]"
      >
        {showingArchived ? <input type="hidden" name="archived" value="1" /> : null}
        <div>
          <Label htmlFor="library-q">{t("documents.search.label")}</Label>
          <Input
            id="library-q"
            name="q"
            defaultValue={query}
            maxLength={200}
            placeholder={t("documents.search.placeholder")}
          />
        </div>
        <div>
          <Label htmlFor="library-folder">{t("documents.search.folder")}</Label>
          <Select id="library-folder" name="folder" defaultValue={activeFolder?.id ?? ""}>
            <option value="">{t("documents.search.allFolders")}</option>
            {groupFolders(folders, t).map((group) => (
              <optgroup key={group.category} label={group.label}>
                {group.folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderLabel(f, t)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="library-tag">{t("documents.search.tag")}</Label>
          <Input id="library-tag" name="tag" defaultValue={tagFilter} maxLength={40} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="secondary">
            <Search className="size-4" aria-hidden />
            {t("documents.search.submit")}
          </Button>
          {filtering ? (
            <Link
              href={showingArchived ? "/documents?archived=1" : "/documents"}
              className="text-[13px] font-medium text-brand-fg hover:underline"
            >
              {t("documents.search.clear")}
            </Link>
          ) : null}
        </div>
      </form>

      <p className="meta mb-3">
        {requiredOnly ? (
          <>
            {t("documents.showingRequired")}{" "}
            <Link href="/documents" className="text-brand-fg hover:underline">
              {t("documents.showEverything")}
            </Link>
          </>
        ) : (
          <Link href="/documents?reading=1" className="text-brand-fg hover:underline">
            {t("documents.showRequired")}
          </Link>
        )}
        {activeFolder ? (
          <span>
            {t("documents.inFolder", { folder: folderLabel(activeFolder, t) })}
            {activeFolder.visibility === "staff" ? t("documents.staffOnlySuffix") : ""}
          </span>
        ) : null}
      </p>

      {rows.length === 0 && (earlierMatches.length > 0 || receiptMatches.length > 0) ? (
        <p className="meta mb-3">{t("documents.noCurrentMatches")}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title={
            filtering
              ? t("documents.empty.noMatchTitle")
              : showingArchived
                ? t("documents.empty.noArchivedTitle")
                : t("documents.empty.noneTitle")
          }
          description={
            filtering
              ? t("documents.empty.noMatchDescription")
              : showingArchived
                ? t("documents.empty.noArchivedDescription")
                : t("documents.empty.noneDescription")
          }
        />
      ) : (
        <>
          <DocumentList
            documents={rows}
            canManage={session.isStaff}
            highlightId={highlightId}
            archived={showingArchived}
            snippets={snippets}
          />
          <DeepLinkScroll
            targetId={highlightId ? `document-${highlightId}` : null}
          />
        </>
      )}

      {earlierMatches.length ? (
        <section aria-labelledby="earlier-matches" className="mt-6">
          <h2 id="earlier-matches" className="mb-2 text-[15px] font-semibold">
            {t("documents.earlierVersions")}
          </h2>
          <ul className="space-y-2">
            {earlierMatches.map((hit) => (
              <li key={hit.id} className="rounded-lg border border-line bg-surface p-3">
                <Link href={`/documents/${hit.id}`} className="font-medium text-brand-fg hover:underline">
                  {hit.title}
                </Link>
                <span className="meta">
                  {t("documents.versionSuffix", { number: hit.version_number ?? "" })}
                </span>
                {hit.snippet ? <SearchSnippet snippet={hit.snippet} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {receiptMatches.length ? (
        <section aria-labelledby="receipt-matches" className="mt-6">
          <h2 id="receipt-matches" className="mb-2 text-[15px] font-semibold">
            {t("documents.receipts")}
          </h2>
          <ul className="space-y-2">
            {receiptMatches.map((hit) => (
              <li key={hit.id} className="rounded-lg border border-line bg-surface p-3">
                <Link
                  href={`/finance/receipts?from=${hit.receipt_date}&to=${hit.receipt_date}`}
                  className="font-medium text-brand-fg hover:underline"
                >
                  {hit.title}
                </Link>
                {hit.snippet ? <SearchSnippet snippet={hit.snippet} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
