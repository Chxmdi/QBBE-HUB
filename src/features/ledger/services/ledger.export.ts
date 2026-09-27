import { requireSession, type SessionContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Gate for the ledger CSV routes: the database decides whether the caller
 * may read the books (the settings row is readable exactly when
 * `app.can_read_ledger` holds: admins with MFA, named ledger readers, and the
 * external accountant with MFA). Null means refuse.
 */
export async function authorizeLedgerExport(): Promise<{ session: SessionContext; supabase: Client } | null> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ledger_settings")
    .select("organization_id")
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (error || !data) return null;
  return { session, supabase };
}

/** The fund a report covers, in the requester's language. */
export async function fundLabel(supabase: Client, fundId: string | null): Promise<string> {
  const t = await getT();
  if (!fundId) return t("finance.ledger.export.allFunds");
  const { data } = await supabase.from("ledger_fund").select("code, name").eq("id", fundId).maybeSingle();
  return data
    ? t("finance.ledger.export.fund", { code: data.code, name: data.name })
    : t("finance.ledger.export.unknownFund");
}

/** Records who took a copy of the books, then returns the file. */
export async function csvResponse(
  supabase: Client,
  session: SessionContext,
  action: string,
  body: string,
  filename: string,
  metadata: Record<string, unknown>,
): Promise<Response> {
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "ledger",
    action,
    object_type: "organization",
    object_id: session.organizationId,
    metadata,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
