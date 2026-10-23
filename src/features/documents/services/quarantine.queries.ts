import { isReleasable } from "@/features/documents/quarantine-reason";
import type { QuarantineKind } from "@/features/documents/services/quarantine.commands";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface QuarantinedFile {
  kind: QuarantineKind;
  id: string;
  name: string;
  status: "quarantined" | "rejected";
  signature: string;
  blockedAt: string | null;
  releasable: boolean;
}

const SOURCES: { kind: QuarantineKind; table: string; name: string }[] = [
  { kind: "document", table: "document", name: "title" },
  { kind: "receipt", table: "finance_receipt", name: "file_name" },
  { kind: "form_file", table: "form_file", name: "file_name" },
  { kind: "signing_document", table: "signing_document", name: "title" },
];

/**
 * Blocked uploads an administrator can act on, newest first, read through
 * the administrator's own session (row-level security). Files already
 * deleted here are left out.
 */
export async function getQuarantinedFiles(limit = 50): Promise<QuarantinedFile[]> {
  const supabase = await createSupabaseServerClient();
  const results = await Promise.all(
    SOURCES.map(async ({ kind, table, name }) => {
      const { data, error } = await supabase
        .from(table)
        .select(`id, ${name}, scan_status, scan_note, quarantined_at`)
        .in("scan_status", ["quarantined", "rejected"])
        .not("scan_note", "like", "Deleted by an administrator%")
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
      }));
    }),
  );
  return results
    .flat()
    .sort((a, b) => (b.blockedAt ?? "").localeCompare(a.blockedAt ?? ""))
    .slice(0, limit);
}
