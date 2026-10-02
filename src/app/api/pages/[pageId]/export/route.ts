import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeContent } from "@/features/editor/adapter/content";
import { createPagesT } from "@/features/pages/i18n";
import { PAGE_COLUMNS, toPageRow, type PageRecordRow } from "@/features/pages/services/page.queries";
import { buildPageExport } from "@/features/pages/transfer/transfer";
import { exportViews } from "@/features/pages/transfer/views.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pageId = z.string().uuid();

/**
 * "Export" on a page (wave 2 unit X1): the page as Markdown, or a zip of the
 * Markdown and one CSV per view block. Everything is read as the exporter,
 * so the page's RLS decides whether there is anything to export and
 * `lens_query` decides every CSV row. A page the exporter cannot open
 * answers 404, the same as one that does not exist. Each export is recorded
 * as an audit event before the bytes leave. Off with the wos_pages switch.
 */
export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  if (!(await isEnabled("wos_pages"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const id = pageId.safeParse((await context.params).pageId);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const limited = await enforceRateLimit("page:export", session.userId);
  if (limited) return NextResponse.json({ error: "rate_limited", message: limited.error }, { status: 429 });

  const supabase = await createSupabaseServerClient();
  const { data: row, error: pageError } = await supabase.from("page").select(PAGE_COLUMNS).eq("id", id.data).maybeSingle();
  if (pageError) return NextResponse.json({ error: "failed" }, { status: 500 });
  const page = row ? toPageRow(row as PageRecordRow) : null;
  if (!page || page.deletedAt) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: body, error: bodyError } = await supabase
    .from("editor_document")
    .select("content")
    .eq("object_id", page.id)
    .maybeSingle();
  if (bodyError) return NextResponse.json({ error: "failed" }, { status: 500 });
  const content = normalizeContent(body?.content ?? null);

  const locale = await getLocale();
  const t = createPagesT(locale);
  const views = await exportViews({
    supabase,
    userId: session.userId,
    timeZone: session.timeZone,
    locale,
    content,
    lensesOn: await isEnabled("wos_lenses"),
    fallbackName: (index) => t("units.x1.export.viewName", { index }),
  });
  const file = buildPageExport({ title: page.title || t("page.untitled"), content, views });

  // The record comes before the bytes: an export nobody can account for is not made.
  const { error: auditError } = await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "data_export",
    action: "page_exported",
    object_type: "page",
    object_id: page.id,
    metadata: {
      format: file.kind,
      views: views.length,
      exportedViews: views.filter((view) => view.csv !== null).length,
    },
  });
  if (auditError) return NextResponse.json({ error: "audit_failed" }, { status: 503 });

  const bytes = typeof file.body === "string" ? new TextEncoder().encode(file.body) : file.body;
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": file.kind === "zip" ? "application/zip" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
