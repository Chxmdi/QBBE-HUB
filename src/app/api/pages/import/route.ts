import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contentToPlainText } from "@/features/editor/adapter/content";
import { positionAtEnd } from "@/features/pages/tree";
import { checkImportFile, IMPORT_MAX_BYTES, IMPORT_MAX_CONTENT_BYTES, importKind } from "@/features/pages/transfer/limits";
import { importToContent } from "@/features/pages/transfer/transfer";
import { readAtMost } from "@/features/pages/transfer/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fields = z.object({
  visibility: z.enum(["workspace", "private"]),
});

/** The form's own fields and boundaries on top of the file. */
const ENVELOPE_BYTES = 16 * 1024;

const fail = (error: string, status: number, message?: string) =>
  NextResponse.json(message ? { error, message } : { error }, { status });

/**
 * "Import" in the pages sidebar (wave 2 unit X1): a Markdown or HTML file
 * becomes a new page at the top of the workspace or private area. The file is
 * size-limited before it is read and rate-limited per person; the page and
 * its body are written as the importer, so the page table's RLS decides
 * whether they may create a page there at all. HTML is read by allowlist
 * (src/features/pages/transfer/html.ts): nothing runnable survives.
 */
export async function POST(request: Request) {
  if (!(await isEnabled("wos_pages"))) return fail("not_found", 404);
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return fail("unauthenticated", 401);
  const limited = await enforceRateLimit("page:import", session.userId);
  if (limited) return fail("rate_limited", 429, limited.error);

  // Refuse an oversized upload before reading it, and stop reading one that
  // grows past the limit without saying its size (a chunked upload).
  const ceiling = IMPORT_MAX_BYTES + ENVELOPE_BYTES;
  if (Number(request.headers.get("content-length") ?? "0") > ceiling) return fail("tooLarge", 413);
  const raw = await readAtMost(request, ceiling);
  if (raw === "tooLarge") return fail("tooLarge", 413);

  let form: FormData;
  try {
    form = await new Response(raw, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return fail("invalid_request", 400);
  }
  const parsed = fields.safeParse({ visibility: form.get("visibility") });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) return fail("invalid_request", 400);
  const problem = checkImportFile(file);
  if (problem) return fail(problem, problem === "tooLarge" ? 413 : problem === "unsupported" ? 415 : 400);
  const kind = importKind(file.name)!;

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return fail("unreadable", 400);
  }
  const { title, content } = importToContent(kind, source, file.name);
  const json = JSON.stringify(content);
  if (json.length > IMPORT_MAX_CONTENT_BYTES) return fail("tooLarge", 413);
  if (content.blocks.length === 0 && title === "") return fail("empty", 400);

  const supabase = await createSupabaseServerClient();
  const { visibility } = parsed.data;
  const { data: siblings } = await supabase
    .from("page")
    .select("position")
    .is("deleted_at", null)
    .is("parent_page_id", null)
    .eq("visibility", visibility);
  const { data: page, error } = await supabase
    .from("page")
    .insert({
      organization_id: session.organizationId,
      parent_page_id: null,
      visibility,
      title,
      position: positionAtEnd((siblings ?? []).map((row) => ({ position: Number(row.position) }))),
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !page) return fail(error?.code === "42501" ? "forbidden" : "failed", error?.code === "42501" ? 403 : 500);

  const { error: bodyError } = await supabase.from("editor_document").insert({
    object_id: page.id,
    object_type: "page",
    organization_id: session.organizationId,
    content,
    content_text: contentToPlainText(content).slice(0, 500000),
    created_by: session.userId,
  });
  if (bodyError) {
    // No page without its body: the empty page goes to the trash (pages are never hard-deleted by people).
    await supabase.from("page").update({ deleted_at: new Date().toISOString() }).eq("id", page.id);
    return fail(bodyError.code === "42501" ? "forbidden" : "failed", bodyError.code === "42501" ? 403 : 500);
  }

  revalidatePath("/pages", "layout");
  return NextResponse.json({ id: page.id as string }, { status: 201 });
}
