import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { QueryError } from "@/lib/query/errors";
import { loadCatalog, parseLensSpec, runLensAll } from "@/lib/query/run";
import { LIMITS } from "@/lib/query/spec";
import { csvFileName, lensToCsv } from "@/features/lenses/csv/export";
import { createLensT } from "@/features/lenses/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rows one file holds at most: the engine's offset cap. */
const EXPORT_LIMIT = LIMITS.maxOffset;

const key = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const body = z.object({
  spec: z.unknown(),
  /** Properties to include, in order; the title is always first. Default: the spec's select. */
  fields: z.array(key).max(LIMITS.maxSelect).optional(),
  /** The lens's name, for the file name only. */
  name: z.string().max(120).optional(),
});

/**
 * Any lens as CSV (Workspace OS U15). The spec runs under the viewer's own
 * session, page by page, so the file holds exactly the rows the viewer can
 * see on screen and nothing more; each export is recorded as an audit event
 * before the bytes leave.
 */
export async function POST(request: Request) {
  if (!(await isEnabled("wos_lenses"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const limited = await enforceRateLimit("lens:export", session.userId);
  if (limited) return NextResponse.json({ error: "rate_limited", message: limited.error }, { status: 429 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  let spec;
  try {
    spec = parseLensSpec(parsed.data.spec);
  } catch (error) {
    return NextResponse.json({ error: error instanceof QueryError ? error.code : "invalid_spec" }, { status: 400 });
  }
  // Everything the lens shows, from the first row: a page's limit and offset
  // are the screen's business, not the file's.
  const { limit: _limit, offset: _offset, ...whole } = spec;
  void _limit;
  void _offset;
  const supabase = await createSupabaseServerClient();
  const locale = await getLocale();
  let catalog;
  let result;
  let fields: string[] | undefined;
  try {
    catalog = await loadCatalog(supabase);
    // Only columns the type can show: a layout saved before a property was
    // removed must not fail the export.
    const shown = new Set((catalog[spec.type]?.properties ?? []).filter((p) => !p.filterOnly).map((p) => p.key));
    fields = parsed.data.fields?.filter((f) => f !== "title" && shown.has(f));
    const full = fields && fields.length > 0 ? { ...whole, select: fields } : whole;
    result = await runLensAll(supabase, full, { timeZone: session.timeZone, maxRows: EXPORT_LIMIT });
  } catch (error) {
    const code = error instanceof QueryError ? error.code : "failed";
    return NextResponse.json({ error: code }, { status: code === "failed" || code === "signed_out" ? 500 : 400 });
  }

  const csv = lensToCsv(result, catalog[spec.type], locale, fields);

  // The record comes before the bytes: an export nobody can account for is
  // not made.
  const { error: auditError } = await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "data_export",
    action: "lens_exported",
    object_type: "lens",
    object_id: null,
    metadata: { type: spec.type, rows: result.rows.length, total: result.total, fields: fields ?? null },
  });
  if (auditError) return NextResponse.json({ error: "audit_failed" }, { status: 503 });

  const t = createLensT(locale);
  const typeName = spec.type === "task" || spec.type === "project" ? t(`types.${spec.type}`) : spec.type;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName([typeName, parsed.data.name])}"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(result.rows.length),
    },
  });
}
