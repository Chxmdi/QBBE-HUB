import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ExportKind, ExportStatus } from "@/features/exports/schemas";

/**
 * Reading the export log.
 *
 * Runs as the signed-in person, so the policy decides the scope: your own
 * requests and anything about you, or — for an administrator — everything the
 * organization has exported.
 */

export interface ExportRow {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  params: Record<string, unknown>;
  row_count: number | null;
  byte_size: number | null;
  error: string | null;
  expires_at: string;
  downloaded_at: string | null;
  download_count: number;
  created_at: string;
  completed_at: string | null;
  requester: { id: string; full_name: string } | null;
  subject: { id: string; full_name: string } | null;
}

const SELECT =
  "id, kind, status, params, row_count, byte_size, error, expires_at, " +
  "downloaded_at, download_count, created_at, completed_at, " +
  "requester:requested_by(id, full_name), subject:subject_user_id(id, full_name)";

export async function getExports(limit = 50): Promise<ExportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("export_job")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as ExportRow[];
}
