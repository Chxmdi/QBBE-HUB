import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAllPages, type PageError } from "@/lib/supabase/fetch-all-pages";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** A submissions CSV with more rows than this is refused (HTTP 413) rather than cut short. */
export const FORM_EXPORT_LIMIT = 50_000;

export interface ExportSubmission {
  id: string;
  submitted_at: string;
  answers: Record<string, unknown>;
  content_sha256: string;
  submitter: { full_name: string } | null;
  signature: { signer_name: string; signed_at: string }[];
}

/**
 * Every submission of a form, oldest first, read a page at a time because the
 * API returns at most 1,000 rows per request (DATA-003): a single request
 * left out the newest submissions once a form passed 1,000. Row-level
 * security decides the rows. The order ends on id so pages neither repeat nor
 * skip a submission.
 */
export async function readSubmissionsForExport(
  supabase: Client,
  formId: string,
  limit: number = FORM_EXPORT_LIMIT,
): Promise<{ rows: ExportSubmission[]; error: PageError | null; truncated: boolean }> {
  return fetchAllPages<ExportSubmission>(
    (start, end) =>
      supabase
        .from("form_submission")
        .select(
          "id, submitted_at, answers, content_sha256, submitter:submitted_by(full_name), signature(signer_name, signed_at)",
        )
        .eq("form_id", formId)
        .order("submitted_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, end)
        // The embedded submitter is a to-one join; the select-string parser types it as a list.
        .overrideTypes<ExportSubmission[], { merge: false }>(),
    limit,
  );
}
