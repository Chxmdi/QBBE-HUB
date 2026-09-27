import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { letterDocument, type AckLanguage } from "@/features/gifts/acknowledgement";

/**
 * An issued thank-you letter or annual statement as a self-contained HTML
 * page (#156): shown for printing, or saved with ?download=1. It renders the
 * stored text exactly as issued, which always includes the bilingual "not an
 * official receipt for income tax purposes" sentence. No PDF, no scripts.
 * Row-level security decides who may read it: admins with MFA and ledger
 * readers. Each read is audited.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaff();
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("gift_acknowledgement")
    .select("id, kind, language, subject, body_text, created_at")
    .eq("organization_id", session.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (!data) return new Response("Not found", { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "gifts",
    action: download ? "acknowledgement_downloaded" : "acknowledgement_viewed",
    object_type: "gift_acknowledgement",
    object_id: data.id,
    metadata: {},
  });

  const html = letterDocument({
    subject: data.subject as string,
    text: data.body_text as string,
    language: data.language as AckLanguage,
  });
  const name = `${data.kind === "annual_statement" ? "statement" : "thank-you"}-${(data.created_at as string).slice(0, 10)}.html`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      // The letter needs nothing but its own inline styles.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      ...(download ? { "Content-Disposition": `attachment; filename="${name}"` } : {}),
    },
  });
}
