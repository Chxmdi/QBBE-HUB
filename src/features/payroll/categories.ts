import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Payroll categories (#155). The same fifteen figures the database stores on
 * a pay run (supabase/migrations/20260929900000_payroll_import.sql,
 * app.payroll_categories), in the same order. Their labels live in the
 * catalogue under `finance.payroll` (#141).
 */

export const PAYROLL_CATEGORIES = [
  { key: "gross_wages", group: "wages", debit: ["expense"], credit: null },
  { key: "ee_federal_tax", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_quebec_tax", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_qpp", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_ei", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_qpip", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_other", group: "employee", debit: null, credit: ["liability"] },
  { key: "er_qpp", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_ei", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_qpip", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_fss", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_cnesst", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_cnt", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_other", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "net_pay", group: "net", debit: null, credit: ["liability", "asset"] },
] as const;

export type PayrollCategory = (typeof PAYROLL_CATEGORIES)[number]["key"];
export type PayrollGroup = (typeof PAYROLL_CATEGORIES)[number]["group"];
export type AccountType = "asset" | "liability" | "net_assets" | "revenue" | "expense";

export const CATEGORY_KEYS = PAYROLL_CATEGORIES.map((c) => c.key) as PayrollCategory[];

/** The short label, as the totals table shows it under its group: "QPP". */
export function categoryShortKey(key: PayrollCategory): MessageKey {
  return `finance.payroll.categories.${key}`;
}

export function groupKey(group: PayrollGroup): MessageKey {
  return `finance.payroll.groups.${group}`;
}

/** "QPP (employee)", "EI (employer)", "Net pay": unambiguous on its own. */
export function categoryLabel(key: PayrollCategory, t: TranslateFn): string {
  return t(`finance.payroll.categoryNames.${key}`);
}

export type RunCents = Record<PayrollCategory, number>;

export function emptyCents(): RunCents {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) as RunCents;
}

export function employeeDeductions(c: RunCents): number {
  return c.ee_federal_tax + c.ee_quebec_tax + c.ee_qpp + c.ee_ei + c.ee_qpip + c.ee_other;
}

export function employerContributions(c: RunCents): number {
  return c.er_qpp + c.er_ei + c.er_qpip + c.er_fss + c.er_cnesst + c.er_cnt + c.er_other;
}

/** The register adds up: gross less the employee's deductions is net pay. */
export function totalsAddUp(c: RunCents): boolean {
  return c.gross_wages - employeeDeductions(c) === c.net_pay;
}

export type PayrollProvider = "nethris" | "employeur_d" | "adp_wfn" | "ceridian_powerpay" | "other";

export const PAYROLL_PROVIDERS: PayrollProvider[] = ["nethris", "employeur_d", "adp_wfn", "ceridian_powerpay", "other"];

/** "Nethris (Desjardins)", "Other CSV (choose the columns)". */
export function providerLabel(provider: PayrollProvider, t: TranslateFn): string {
  return t(`finance.payroll.providers.${provider}`);
}

/** The provider's name without its parenthesis: "Nethris", "Other CSV". */
export function providerShortLabel(provider: PayrollProvider, t: TranslateFn): string {
  return providerLabel(provider, t).replace(/ \(.*\)$/, "");
}
