import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AgingRow, DocumentKind } from "@/features/payables/model";
import { fetchAllPages, type PageError } from "@/lib/supabase/fetch-all-pages";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** An aging report with more open documents than this is refused or flagged rather than cut short. */
export const AGING_LIMIT = 50_000;

/**
 * Every open bill (or invoice) as at a date, read a page at a time because the
 * API returns at most 1,000 rows per request (DATA-003). Row-level security
 * decides what is included. The order ends on the document id so pages
 * neither repeat nor skip a document.
 */
export async function readAging(
  supabase: Client,
  organizationId: string,
  kind: DocumentKind,
  asOf: string,
  limit: number = AGING_LIMIT,
): Promise<{ rows: AgingRow[]; error: PageError | null; truncated: boolean }> {
  const { rows, error, truncated } = await fetchAllPages<AgingRow>(
    (start, end) =>
      supabase
        .rpc("finance_aging", { p_organization: organizationId, p_kind: kind, p_as_of: asOf })
        .order("contact_name")
        .order("due_date")
        .order("document_date")
        .order("document_id")
        .range(start, end),
    limit,
  );
  return {
    rows: rows.map((r) => ({ ...r, total_cents: Number(r.total_cents), open_cents: Number(r.open_cents) })),
    error,
    truncated,
  };
}
