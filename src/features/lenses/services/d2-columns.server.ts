import type { SessionContext } from "@/lib/auth";
import type { CatalogType } from "@/lib/query/catalog";
import { reportError } from "@/lib/observability";
import {
  applyColumnSettings,
  totalsChoicesSchema,
  type ColumnSetting,
  type D2CatalogType,
  type TotalsChoices,
} from "@/features/lenses/table/units/d2-model";

/** The reads the loader makes; RLS decides what comes back. */
interface Reader {
  from: (table: string) => unknown;
}

type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: Promise<{ data: unknown; error: unknown }>["then"];
};

/**
 * Wave 2 unit D2: the catalog type for the table page with the
 * organization's column settings (names, hidden columns) and the viewer's
 * saved totals. A read that fails leaves the catalog as it is: the table
 * still opens, with its own names and default totals.
 */
export async function withD2Columns<T extends CatalogType | undefined>(
  client: Reader,
  session: Pick<SessionContext, "userId" | "organizationId" | "isAdmin">,
  type: T,
): Promise<T> {
  if (!type) return type;
  let settings: ColumnSetting[] = [];
  let totals: TotalsChoices | null = null;
  try {
    const [columns, mine] = await Promise.all([
      (client.from("lens_column_setting") as Query)
        .select("property_key, name_en, name_fr, hidden")
        .eq("organization_id", session.organizationId)
        .eq("type_key", type.key),
      (client.from("lens_totals_setting") as Query)
        .select("choices")
        .eq("user_id", session.userId)
        .eq("type_key", type.key)
        .maybeSingle(),
    ]);
    if (!columns.error && Array.isArray(columns.data)) settings = columns.data as ColumnSetting[];
    const parsed = totalsChoicesSchema.safeParse((mine.data as { choices?: unknown } | null)?.choices);
    if (!mine.error && parsed.success) totals = parsed.data;
  } catch (error) {
    reportError(error, { lens: "table", step: "d2-columns" });
  }
  const applied = applyColumnSettings(type, settings);
  const original: Record<string, { en: string; fr: string }> = {};
  for (const p of type.properties) original[p.key] = { en: p.name.en, fr: p.name.fr };
  const out: D2CatalogType = {
    ...applied.type,
    d2: { canManage: session.isAdmin, totals, hidden: applied.hidden, original },
  };
  return out as T;
}
