import type { SupabaseClient } from "@supabase/supabase-js";

/** Filters shared by the receipts page and its CSV export. */
export interface ReceiptFilters {
  from?: string;
  to?: string;
  programId?: string;
  status?: "submitted" | "reviewed";
  mine?: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads filters from the query string, dropping anything malformed. */
export function parseReceiptFilters(params: Record<string, string | undefined>): ReceiptFilters {
  return {
    from: params.from && DATE.test(params.from) ? params.from : undefined,
    to: params.to && DATE.test(params.to) ? params.to : undefined,
    programId: params.program && UUID.test(params.program) ? params.program : undefined,
    status:
      params.status === "submitted" || params.status === "reviewed" ? params.status : undefined,
    mine: params.mine === "1",
  };
}

export const RECEIPT_COLUMNS =
  "id, kind, document_date, vendor, total_cents, gst_cents, qst_cents, note, file_name, " +
  "scan_status, status, submitted_by, reviewed_at, created_at, " +
  "submitter:submitted_by(full_name), program:program_id(name), project:project_id(name)";

/**
 * Receipts the caller may see (row-level security decides that), newest
 * document date first. `userId` is only used for the "mine" filter.
 */
export function receiptQuery(
  supabase: SupabaseClient,
  filters: ReceiptFilters,
  userId: string,
  limit: number,
) {
  let query = supabase.from("finance_receipt").select(RECEIPT_COLUMNS);
  if (filters.from) query = query.gte("document_date", filters.from);
  if (filters.to) query = query.lte("document_date", filters.to);
  if (filters.programId) query = query.eq("program_id", filters.programId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.mine) query = query.eq("submitted_by", userId);
  return query
    .order("document_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
}
