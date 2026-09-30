import type { createSupabasePageClient } from "@/lib/supabase/page";
import { liveRows, type PageRow } from "@/features/pages/tree";

/**
 * Reads for the pages screens (M4a). Run through the page client, so a failed
 * read reaches the workspace error boundary, and under the reader's RLS, so a
 * page they cannot see is simply absent.
 */

type PageClient = Awaited<ReturnType<typeof createSupabasePageClient>>;

export const PAGE_COLUMNS =
  "id, parent_page_id, visibility, title, icon, cover, position, created_by, updated_at, deleted_at";

export interface PageRecordRow {
  id: string;
  parent_page_id: string | null;
  visibility: "workspace" | "private";
  title: string;
  icon: string | null;
  cover: string | null;
  position: number;
  created_by: string;
  updated_at: string;
  deleted_at: string | null;
}

export function toPageRow(row: PageRecordRow): PageRow {
  return {
    id: row.id,
    parentPageId: row.parent_page_id,
    visibility: row.visibility,
    title: row.title,
    icon: row.icon,
    cover: row.cover,
    position: Number(row.position),
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface PagesSidebarData {
  pages: PageRow[];
  favouriteIds: string[];
  recentIds: string[];
}

/** Every live page the reader can see (trashed trees left out), plus their favourites and recent pages. */
export async function loadSidebar(client: PageClient, userId: string): Promise<PagesSidebarData> {
  const [pages, favourites, visits] = await Promise.all([
    client.from("page").select(PAGE_COLUMNS).order("position"),
    client
      .from("page_favourite")
      .select("page_id, position")
      .eq("user_id", userId)
      .order("position")
      .order("created_at"),
    client
      .from("page_visit")
      .select("page_id")
      .eq("user_id", userId)
      .order("visited_at", { ascending: false })
      .limit(8),
  ]);
  const rows = liveRows(((pages.data ?? []) as PageRecordRow[]).map(toPageRow));
  const live = new Set(rows.map((row) => row.id));
  return {
    pages: rows,
    favouriteIds: (favourites.data ?? []).map((f) => f.page_id as string).filter((pid) => live.has(pid)),
    recentIds: (visits.data ?? []).map((v) => v.page_id as string).filter((pid) => live.has(pid)),
  };
}

/** One page, including a trashed one (so it can be restored), or null. */
export async function loadPage(client: PageClient, pageId: string): Promise<PageRow | null> {
  const { data } = await client.from("page").select(PAGE_COLUMNS).eq("id", pageId).maybeSingle();
  return data ? toPageRow(data as PageRecordRow) : null;
}

/** The reader's access to one page, from the database's own rule. */
export async function pageAccess(
  client: PageClient,
  pageId: string,
): Promise<{ canEdit: boolean }> {
  const { data } = await client.rpc("can_page", { page_id: pageId, capability: "edit_content" });
  return { canEdit: data === true };
}
