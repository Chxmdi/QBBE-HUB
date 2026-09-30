"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getPagesT } from "@/features/pages/i18n/server";
import {
  createPageSchema,
  movePageSchema,
  pageIdSchema,
  renamePageSchema,
  setPageCoverSchema,
  setPageIconSchema,
  stepPageSchema,
} from "@/features/pages/schemas";
import {
  isMoveIntoOwnSubtree,
  positionAtEnd,
  positionForStep,
} from "@/features/pages/tree";
import { PAGE_COLUMNS, toPageRow, type PageRecordRow } from "./page.queries";

/**
 * Page writes (M4a). Every write runs as the signed-in person, so the page
 * table's RLS and triggers decide what is allowed; these actions only shape
 * input and turn refusals into sentences. All of them are off unless the
 * `wos_pages` switch is on.
 */

export interface PageActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function prepare() {
  const t = await getPagesT();
  if (!(await isEnabled("wos_pages"))) {
    return { t, blocked: { ok: false, error: t("errors.notAllowed") } as PageActionResult };
  }
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  return { t, session, supabase, blocked: null };
}

function refresh(pageId?: string) {
  revalidatePath("/pages", "layout");
  if (pageId) revalidatePath(`/pages/${pageId}`);
}

/** Postgres refusals raised by RLS or the page triggers, as a sentence. */
function refusal(
  t: Awaited<ReturnType<typeof getPagesT>>,
  error: { code?: string; message?: string } | null,
): string {
  if (!error) return t("errors.failed");
  if (error.code === "23514") return t("errors.cannotMoveInside");
  if (error.code === "42501" || error.code === "PGRST116") return t("errors.notAllowed");
  return t("errors.failed");
}

async function siblings(
  supabase: ServerClient,
  parentPageId: string | null,
  visibility: "workspace" | "private",
) {
  let query = supabase
    .from("page")
    .select("id, position, title")
    .is("deleted_at", null)
    .eq("visibility", visibility);
  query = parentPageId ? query.eq("parent_page_id", parentPageId) : query.is("parent_page_id", null);
  const { data } = await query;
  return (data ?? []).map((row) => ({ ...row, position: Number(row.position) })) as {
    id: string;
    position: number;
    title: string;
  }[];
}

/** Updates one page and reports whether the reader was allowed to. */
async function updatePage(
  pageId: string,
  patch: Record<string, unknown>,
): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, supabase } = ready;
  const { data, error } = await supabase
    .from("page")
    .update(patch)
    .eq("id", pageId)
    .select("id");
  if (error) return { ok: false, error: refusal(t, error) };
  if (!data || data.length === 0) return { ok: false, error: t("errors.notAllowed") };
  refresh(pageId);
  return { ok: true, id: pageId };
}

export async function createPage(input: unknown): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, session, supabase } = ready;
  const parsed = createPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { parentPageId = null, title = "" } = parsed.data;
  let visibility = parsed.data.visibility;

  if (parentPageId) {
    const { data: parent } = await supabase
      .from("page")
      .select("visibility")
      .eq("id", parentPageId)
      .maybeSingle();
    if (!parent) return { ok: false, error: t("errors.notFound") };
    visibility = parent.visibility as typeof visibility;
  }

  const position = positionAtEnd(await siblings(supabase, parentPageId, visibility));
  const { data, error } = await supabase
    .from("page")
    .insert({
      organization_id: session.organizationId,
      parent_page_id: parentPageId,
      visibility,
      title,
      position,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: refusal(t, error) };
  refresh();
  return { ok: true, id: data.id as string };
}

export async function renamePage(input: unknown): Promise<PageActionResult> {
  const parsed = renamePageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getPagesT())("errors.invalidInput") };
  return updatePage(parsed.data.pageId, { title: parsed.data.title });
}

export async function setPageIcon(input: unknown): Promise<PageActionResult> {
  const parsed = setPageIconSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getPagesT())("errors.invalidInput") };
  return updatePage(parsed.data.pageId, { icon: parsed.data.icon || null });
}

export async function setPageCover(input: unknown): Promise<PageActionResult> {
  const parsed = setPageCoverSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getPagesT())("errors.invalidInput") };
  return updatePage(parsed.data.pageId, { cover: parsed.data.cover });
}

export async function movePage(input: unknown): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, supabase } = ready;
  const parsed = movePageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { pageId, parentPageId, visibility } = parsed.data;

  const { data: rows } = await supabase.from("page").select("id, parent_page_id");
  const tree = (rows ?? []).map((row) => ({
    id: row.id as string,
    parentPageId: row.parent_page_id as string | null,
  }));
  if (isMoveIntoOwnSubtree(tree, pageId, parentPageId)) {
    return { ok: false, error: t("errors.cannotMoveInside") };
  }
  const position =
    parsed.data.position ??
    positionAtEnd((await siblings(supabase, parentPageId, visibility)).filter((s) => s.id !== pageId));
  return updatePage(pageId, { parent_page_id: parentPageId, visibility, position });
}

/** Moves a page one step up or down among its siblings (the keyboard alternative to dragging). */
export async function stepPage(input: unknown): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, supabase } = ready;
  const parsed = stepPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { data: page } = await supabase
    .from("page")
    .select("parent_page_id, visibility")
    .eq("id", parsed.data.pageId)
    .maybeSingle();
  if (!page) return { ok: false, error: t("errors.notFound") };
  const position = positionForStep(
    await siblings(supabase, page.parent_page_id as string | null, page.visibility as "workspace" | "private"),
    parsed.data.pageId,
    parsed.data.direction,
  );
  if (position === null) return { ok: true, id: parsed.data.pageId };
  return updatePage(parsed.data.pageId, { position });
}

/** Copies a page's title, icon and cover next to the original. Its body follows with M4c. */
export async function duplicatePage(input: unknown): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, session, supabase } = ready;
  const parsed = pageIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { data } = await supabase
    .from("page")
    .select(PAGE_COLUMNS)
    .eq("id", parsed.data.pageId)
    .maybeSingle();
  if (!data) return { ok: false, error: t("errors.notFound") };
  const original = toPageRow(data as PageRecordRow);
  const peers = await siblings(supabase, original.parentPageId, original.visibility);
  const after = peers
    .filter((p) => p.position > original.position)
    .reduce<number | null>((min, p) => (min === null || p.position < min ? p.position : min), null);
  const position = after === null ? original.position + 1024 : (original.position + after) / 2;

  const { data: copy, error } = await supabase
    .from("page")
    .insert({
      organization_id: session.organizationId,
      parent_page_id: original.parentPageId,
      visibility: original.visibility,
      title: t("copySuffix", { title: original.title || t("page.untitled") }).slice(0, 500),
      icon: original.icon,
      cover: original.cover,
      position,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !copy) return { ok: false, error: refusal(t, error) };
  refresh();
  return { ok: true, id: copy.id as string };
}

export async function trashPage(input: unknown): Promise<PageActionResult> {
  const parsed = pageIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getPagesT())("errors.invalidInput") };
  return updatePage(parsed.data.pageId, { deleted_at: new Date().toISOString() });
}

export async function restorePage(input: unknown): Promise<PageActionResult> {
  const parsed = pageIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (await getPagesT())("errors.invalidInput") };
  return updatePage(parsed.data.pageId, { deleted_at: null });
}

export async function setFavourite(input: unknown, favourite: boolean): Promise<PageActionResult> {
  const ready = await prepare();
  if (ready.blocked) return ready.blocked;
  const { t, session, supabase } = ready;
  const parsed = pageIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidInput") };
  const { pageId } = parsed.data;
  const { error } = favourite
    ? await supabase
        .from("page_favourite")
        .upsert({ user_id: session.userId, page_id: pageId, position: Date.now() }, { onConflict: "user_id,page_id" })
    : await supabase.from("page_favourite").delete().eq("user_id", session.userId).eq("page_id", pageId);
  if (error) return { ok: false, error: refusal(t, error) };
  refresh(pageId);
  return { ok: true, id: pageId };
}

/**
 * Records that the reader opened a page, for their Recent list. Called while
 * rendering the page, so it never revalidates and never throws.
 */
export async function recordPageVisit(pageId: string): Promise<void> {
  try {
    const session = await requireSession();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("page_visit")
      .upsert(
        { user_id: session.userId, page_id: pageId, visited_at: new Date().toISOString() },
        { onConflict: "user_id,page_id" },
      );
    if (error) console.warn("page visit not recorded", error.code);
  } catch {
    // A missed Recent entry is not worth failing the page for.
  }
}
