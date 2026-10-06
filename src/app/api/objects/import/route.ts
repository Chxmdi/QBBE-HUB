import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import type { LocalizedText } from "@/lib/objects/contracts";
import { enforceRateLimit } from "@/lib/rate-limit";
import { crossSiteResponse, isSameOriginRequest } from "@/lib/same-origin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/query/run";
import { createRequestActionRegistry, statusForActionFailure } from "@/features/objects/actions/server";
import {
  IMPORT_ACTION,
  IMPORT_ROW_LIMIT,
  type ImportFailure,
  type ImportInput,
  type ImportRow,
} from "@/features/objects/actions/import-rows";
import { FILE_MESSAGES, toCreateInput, validateRows, type RowError } from "@/features/lenses/csv/import";
import { loadImportRefs } from "@/features/lenses/csv/refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const header = z.string().min(1).max(200);
const body = z.object({
  typeKey: z.enum(["task", "project"]),
  /** Header name to property key; null skips the column. */
  mapping: z.record(header, key.nullable()),
  /** One object per data row, keyed by header. */
  rows: z.array(z.record(header, z.string().max(10_000))).min(1).max(IMPORT_ROW_LIMIT),
});

export interface ImportResponse {
  created: number;
  skipped: number;
  errors: RowError[];
  changeSetId: string | null;
  /** False when the undo route is switched off (wos_objects), so the screen offers no Undo. */
  undoAvailable: boolean;
}

const FAILURES: Record<ImportFailure, LocalizedText> = {
  forbidden: {
    en: "You cannot add records there (the project or program is not yours to edit).",
    fr: "Vous ne pouvez pas ajouter d’éléments à cet endroit (le projet ou le programme n’est pas modifiable par vous).",
  },
  invalid: { en: "The row's values were refused.", fr: "Les valeurs de la ligne ont été refusées." },
  failed: { en: "The record could not be created.", fr: "L’élément n’a pas pu être créé." },
};

/**
 * CSV import (Workspace OS U15): validates every row, then creates the valid
 * ones through the action registry as ONE change set that the undo route can
 * take back. Rows that fail are skipped and reported; the rest still land.
 */
export async function POST(request: Request) {
  if (!(await isEnabled("wos_lenses"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isSameOriginRequest(request)) return crossSiteResponse();
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const limited = await enforceRateLimit("import:run", session.userId);
  if (limited) return NextResponse.json({ error: "rate_limited", message: limited.error }, { status: 429 });

  const raw = await request.json().catch(() => null);
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    const tooMany = Array.isArray((raw as { rows?: unknown })?.rows) && ((raw as { rows: unknown[] }).rows.length > IMPORT_ROW_LIMIT);
    return NextResponse.json(
      tooMany ? { error: "too_many_rows", message: FILE_MESSAGES.tooManyRows(IMPORT_ROW_LIMIT) } : { error: "invalid_request" },
      { status: 400 },
    );
  }
  const { typeKey, mapping, rows } = parsed.data;

  const supabase = await createSupabaseServerClient();
  let catalog;
  let refs;
  try {
    [catalog, refs] = await Promise.all([loadCatalog(supabase), loadImportRefs(supabase)]);
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  const type = catalog[typeKey];
  if (!type) return NextResponse.json({ error: "unknown_type" }, { status: 400 });

  const headers = Object.keys(mapping);
  const validation = validateRows({
    type,
    headers,
    rows: rows.map((row) => headers.map((h) => row[h] ?? "")),
    mapping,
    refs,
  });
  const errors: RowError[] = [...validation.errors];
  const undoAvailable = await isEnabled("wos_objects", supabase);
  const respond = (created: number, changeSetId: string | null, status = 200) =>
    NextResponse.json(
      {
        created,
        skipped: validation.total - created,
        errors: errors.sort((a, b) => a.row - b.row),
        changeSetId,
        undoAvailable,
      } satisfies ImportResponse,
      { status },
    );
  if (validation.rows.length === 0) return respond(0, null);

  const { registry, context } = await createRequestActionRegistry(session.userId);
  const importRows: ImportRow[] = validation.rows.map((r) => ({ row: r.row, input: toCreateInput(typeKey, r.values) }));
  const result = await registry.run(
    IMPORT_ACTION,
    {
      typeKey,
      rows: importRows,
      report: (row: number, failure: ImportFailure) => errors.push({ row, column: null, message: FAILURES[failure] }),
    } satisfies ImportInput,
    context,
  );
  if (!result.ok) {
    // Every valid row failed: still an answer, with each row's reason.
    if (result.reason === "failed" && result.message === "Nothing changed.") return respond(0, null);
    return NextResponse.json(
      { error: result.reason, message: result.message ?? null },
      { status: statusForActionFailure(result.reason, result.message) },
    );
  }
  const created = result.changeSet.changes.filter((c) => c.kind === "create").length;
  return respond(created, result.changeSet.id);
}
