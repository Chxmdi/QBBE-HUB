import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  LegalHoldRow,
  RecordCategory,
  RegisterRow,
  RetentionRuleRow,
} from "@/features/record-retention/schemas";

/**
 * Everything the Records & holds screen shows, read as the signed-in
 * administrator. Row security decides what comes back; the register function
 * refuses anybody who is not an administrator with MFA.
 */

export interface DocumentOption {
  id: string;
  title: string;
  record_category: string | null;
  record_date: string | null;
}

export interface RetentionReportRow {
  generated_at: string;
  past_retention_count: number;
  held_count: number;
  by_category: Record<string, number>;
}

export interface RecordRetentionOverview {
  categories: RecordCategory[];
  rules: RetentionRuleRow[];
  fiscalYearEnd: { month: number; day: number } | null;
  holds: LegalHoldRow[];
  register: RegisterRow[];
  documents: DocumentOption[];
  latestReport: RetentionReportRow | null;
}

export async function getRecordRetentionOverview(
  organizationId: string,
): Promise<RecordRetentionOverview> {
  const supabase = await createSupabaseServerClient();

  const [categories, rules, setting, holds, register, documents, report] =
    await Promise.all([
      supabase.from("record_category").select("*").order("sort_order"),
      supabase
        .from("record_retention_rule")
        .select("category_key, retain_years, confirmed_at, confirmed_by, confirmation_note")
        .eq("organization_id", organizationId),
      supabase
        .from("record_retention_setting")
        .select("fiscal_year_end_month, fiscal_year_end_day")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("legal_hold")
        .select("id, scope, category_key, record_type, record_id, reason, placed_by, placed_at")
        .eq("organization_id", organizationId)
        .is("released_at", null)
        .order("placed_at", { ascending: false }),
      supabase.rpc("record_retention_register", { p_organization: organizationId }),
      supabase
        .from("document")
        .select("id, title, record_category, record_date")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("record_retention_report")
        .select("generated_at, past_retention_count, held_count, by_category")
        .eq("organization_id", organizationId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const settingRow = setting.data as
    | { fiscal_year_end_month: number; fiscal_year_end_day: number }
    | null;

  return {
    categories: (categories.data ?? []) as RecordCategory[],
    rules: (rules.data ?? []) as RetentionRuleRow[],
    fiscalYearEnd: settingRow
      ? { month: settingRow.fiscal_year_end_month, day: settingRow.fiscal_year_end_day }
      : null,
    holds: (holds.data ?? []) as LegalHoldRow[],
    register: (register.data ?? []) as RegisterRow[],
    documents: (documents.data ?? []) as DocumentOption[],
    latestReport: (report.data ?? null) as RetentionReportRow | null,
  };
}
