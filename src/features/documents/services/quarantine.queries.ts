import { isDeletedByAdministrator, isReleasable } from "@/features/documents/quarantine-reason";
import type { QuarantineKind } from "@/features/documents/services/quarantine.commands";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface QuarantinedFile {
  kind: QuarantineKind;
  id: string;
  name: string;
  status: "quarantined" | "rejected";
  signature: string;
  blockedAt: string | null;
  releasable: boolean;
  /** Deleted here; the delete can be repeated if the file itself was not removed. */
  deleted: boolean;
}

const SOURCES: { kind: QuarantineKind; table: string; name: string }[] = [
  { kind: "document", table: "document", name: "title" },
  { kind: "receipt", table: "finance_receipt", name: "file_name" },
  { kind: "form_file", table: "form_file", name: "file_name" },
  { kind: "signing_document", table: "signing_document", name: "title" },
];

/**
 * Blocked uploads of the administrator's current organization, newest first,
 * read through their own session (row-level security). A file deleted here
 * stays listed for a week, so a deletion whose file removal failed can be
 * repeated.
 */
export async function getQuarantinedFiles(limit = 50, now = new Date()): Promise<QuarantinedFile[]> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const deletedSince = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.all(
    SOURCES.map(async ({ kind, table, name }) => {
      const { data, error } = await supabase
        .from(table)
        .select(`id, ${name}, scan_status, scan_note, quarantined_at`)
        .eq("organization_id", session.organizationId)
        .in("scan_status", ["quarantined", "rejected"])
        .or(`scan_note.is.null,scan_note.not.like."Deleted by an administrator*",quarantined_at.gte.${deletedSince}`)
        .order("quarantined_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw new Error(`Could not load blocked files: ${error.message}`);
      return ((data ?? []) as unknown as Record<string, string | null>[]).map((row): QuarantinedFile => ({
        kind,
        id: row.id as string,
        name: (row[name] as string | null) ?? "",
        status: row.scan_status as "quarantined" | "rejected",
        signature: row.scan_note ?? "",
        blockedAt: row.quarantined_at,
        releasable: isReleasable(row.scan_status, row.scan_note),
        deleted: isDeletedByAdministrator(row.scan_note),
      }));
    }),
  );
  return results
    .flat()
    .sort((a, b) => (b.blockedAt ?? "").localeCompare(a.blockedAt ?? ""))
    .slice(0, limit);
}
