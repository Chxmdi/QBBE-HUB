"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { documentIdFromRef } from "@/features/editor/adapter/files";

/**
 * Where a pasted file's security check stands (wave 2 unit E1), so its block
 * can say "pending" while the scan runs and "refused" when the file fails it.
 * Read as the signed-in person: a file they cannot see reads as unknown.
 */

export type PasteScanState = "pending" | "clean" | "refused" | "unknown";

const refSchema = z.string().max(200);

export async function pastedFileScanState(ref: unknown): Promise<PasteScanState> {
  await requireSession();
  if (!(await isEnabled("wos_editor"))) return "unknown";
  const parsed = refSchema.safeParse(ref);
  const documentId = parsed.success ? documentIdFromRef(parsed.data) : null;
  if (!documentId) return "unknown";
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("document").select("scan_status").eq("id", documentId).maybeSingle();
  if (!data) return "unknown";
  if (data.scan_status === "clean") return "clean";
  if (data.scan_status === "pending") return "pending";
  return "refused";
}
