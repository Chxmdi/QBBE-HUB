"use server";

import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCatalog } from "@/lib/query/run";
import { getLensT } from "@/features/lenses/i18n/server";
import { columnRenameSchema, columnVisibilitySchema, totalsSaveSchema, allowedTotals } from "@/features/lenses/table/units/d2-model";

/**
 * Wave 2 unit D2: column changes for everyone (owners and admins only) and
 * one viewer's choice of totals. Every action checks the session and the
 * wos_lenses switch, validates with zod and against the engine's catalog,
 * and is rate limited. RLS on lens_column_setting (admins at two-step
 * sign-in) and lens_totals_setting (own row only) is still the authority.
 *
 * Both use the "property:write" limit: a column's name and visibility are
 * property metadata, and a totals choice is one human click per write.
 */

export interface D2Result {
  ok: boolean;
  error?: string;
}

async function guard() {
  const session = await requireSession();
  const t = await getLensT();
  const supabase = await createSupabaseServerClient();
  const enabled = await isEnabled("wos_lenses", supabase);
  return { session, t, supabase, enabled };
}

/** The catalog property a change names, when it is a column (not filter-only). */
async function columnOf(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, type: string, property: string) {
  try {
    const catalog = await loadCatalog(supabase);
    return catalog[type]?.properties.find((p) => p.key === property && !p.filterOnly) ?? null;
  } catch {
    return null;
  }
}

async function writeColumn(input: unknown, kind: "rename" | "visibility"): Promise<D2Result> {
  const { session, t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("units.d2.columns.failed") };
  if (!session.isAdmin) return { ok: false, error: t("units.d2.columns.notAllowed") };
  const parsed = kind === "rename" ? columnRenameSchema.safeParse(input) : columnVisibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("units.d2.columns.invalid") };
  const data = parsed.data;
  if ("hidden" in data && data.hidden && data.property === "title") return { ok: false, error: t("units.d2.columns.invalid") };
  const limited = await enforceRateLimit("property:write", session.userId);
  if (limited) return limited;
  if (!(await columnOf(supabase, data.type, data.property))) return { ok: false, error: t("units.d2.columns.invalid") };

  const patch =
    "hidden" in data ? { hidden: data.hidden } : { name_en: data.nameEn.trim(), name_fr: data.nameFr.trim() };
  const { data: row, error } = await supabase
    .from("lens_column_setting")
    .upsert(
      { organization_id: session.organizationId, type_key: data.type, property_key: data.property, ...patch },
      { onConflict: "organization_id,type_key,property_key" },
    )
    .select("property_key")
    .maybeSingle();
  // RLS refuses anyone who is not an owner or admin at two-step sign-in.
  if (error || !row) return { ok: false, error: error?.code === "42501" ? t("units.d2.columns.notAllowed") : t("units.d2.columns.failed") };
  return { ok: true };
}

/** Rename a column for everyone in the organization (both languages). */
export async function renameColumnForEveryone(input: unknown): Promise<D2Result> {
  return writeColumn(input, "rename");
}

/** Hide a column from everyone's table, or add a hidden one back. */
export async function setColumnHiddenForEveryone(input: unknown): Promise<D2Result> {
  return writeColumn(input, "visibility");
}

/** The viewer's choice of total per column for one type's table. */
export async function saveTotalsChoice(input: unknown): Promise<D2Result> {
  const { session, t, supabase, enabled } = await guard();
  if (!enabled) return { ok: false, error: t("units.d2.totals.saveFailed") };
  const parsed = totalsSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("units.d2.totals.saveFailed") };
  const limited = await enforceRateLimit("property:write", session.userId);
  if (limited) return limited;
  let catalog;
  try {
    catalog = await loadCatalog(supabase);
  } catch {
    return { ok: false, error: t("units.d2.totals.saveFailed") };
  }
  const type = catalog[parsed.data.type];
  if (!type) return { ok: false, error: t("units.d2.totals.saveFailed") };
  // Only what the catalog still allows: a column since removed (or made
  // filter-only) or a total its kind no longer has is dropped, so an old
  // choice never blocks saving the new ones.
  const choices: Record<string, string> = {};
  for (const [key, fn] of Object.entries(parsed.data.choices)) {
    const p = type.properties.find((x) => x.key === key && !x.filterOnly);
    if (p && allowedTotals(p).includes(fn)) choices[key] = fn;
  }
  const { error } = await supabase
    .from("lens_totals_setting")
    .upsert({ user_id: session.userId, type_key: parsed.data.type, choices }, { onConflict: "user_id,type_key" });
  if (error) return { ok: false, error: t("units.d2.totals.saveFailed") };
  return { ok: true };
}
