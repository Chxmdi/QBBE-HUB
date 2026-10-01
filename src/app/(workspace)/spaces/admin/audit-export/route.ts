import { NextResponse } from "next/server";
import { z } from "zod";
import { toCsv } from "@/features/spaces/admin/sign-in-rules";
import { authorizeAdminAction } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PostgREST answers at most `max_rows` rows per request (1,000 in
 * supabase/config.toml and on the hosted projects) and says nothing when it
 * cuts a larger ask short, so the export reads page by page of that size until
 * a page comes back short. One request of `.limit(50_000)` returned the oldest
 * 1,000 events and nothing else, and the CSV looked complete (I4 notes, R3).
 */
const PAGE_ROWS = 1_000;
const MAX_ROWS = 50_000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Audit log export (V2-9): owners and admins with two-step sign-in download
 * audit_event for a date range as CSV. Read through audit_event's own policy
 * (admins of this organization only), and recorded in the audit log itself.
 */
export async function GET(request: Request) {
  if (!(await isEnabled("wos_spaces"))) return new NextResponse("Not found", { status: 404 });
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return new NextResponse("Forbidden", { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = day.safeParse(params.get("from"));
  const to = day.safeParse(params.get("to"));
  if (!from.success || !to.success || from.data > to.data) {
    return new NextResponse("Choose a start and end date (YYYY-MM-DD).", { status: 400 });
  }

  const db = await createSupabaseServerClient();
  const organizationId = authorization.session.organizationId;
  const rangeEnd = new Date(Date.parse(`${to.data}T00:00:00Z`) + 86_400_000).toISOString();
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_ROWS) {
    const { data, error } = await db
      .from("audit_event")
      .select("created_at, actor_id, actor_type, event_type, action, result, object_type, object_id, metadata")
      .eq("organization_id", organizationId)
      .gte("created_at", `${from.data}T00:00:00Z`)
      .lt("created_at", rangeEnd)
      // The id breaks ties between events written in the same instant, so
      // consecutive pages never overlap or skip a row.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_ROWS - 1);
    if (error) return new NextResponse("The audit log could not be read.", { status: 500 });
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_ROWS) break;
  }

  await db.from("audit_event").insert({
    organization_id: organizationId,
    actor_id: authorization.session.userId,
    event_type: "export",
    action: "audit_log_exported",
    object_type: "audit_event",
    metadata: { from: from.data, to: to.data, rows: rows.length },
  });

  const header = ["created_at", "actor_id", "actor_type", "event_type", "action", "result", "object_type", "object_id", "metadata"];
  const csv = toCsv(header, rows.map((row) => header.map((key) => row[key])));
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${from.data}-to-${to.data}.csv"`,
      "cache-control": "no-store",
    },
  });
}
