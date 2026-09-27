/**
 * Payroll categories (#155). The same fifteen figures the database stores on
 * a pay run (supabase/migrations/20260929200000_payroll_import.sql,
 * app.payroll_categories), in the same order.
 */

export const PAYROLL_CATEGORIES = [
  { key: "gross_wages", label: "Gross wages", group: "wages", debit: ["expense"], credit: null },
  { key: "ee_federal_tax", label: "Federal income tax", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_quebec_tax", label: "Quebec income tax", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_qpp", label: "QPP", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_ei", label: "EI", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_qpip", label: "QPIP", group: "employee", debit: null, credit: ["liability"] },
  { key: "ee_other", label: "Other deductions", group: "employee", debit: null, credit: ["liability"] },
  { key: "er_qpp", label: "QPP", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_ei", label: "EI", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_qpip", label: "QPIP", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_fss", label: "Health Services Fund (FSS)", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_cnesst", label: "CNESST", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_cnt", label: "CNT (labour standards)", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "er_other", label: "Other contributions", group: "employer", debit: ["expense"], credit: ["liability"] },
  { key: "net_pay", label: "Net pay", group: "net", debit: null, credit: ["liability", "asset"] },
] as const;

export type PayrollCategory = (typeof PAYROLL_CATEGORIES)[number]["key"];
export type AccountType = "asset" | "liability" | "net_assets" | "revenue" | "expense";

export const CATEGORY_KEYS = PAYROLL_CATEGORIES.map((c) => c.key) as PayrollCategory[];

export const GROUP_LABEL = {
  wages: "Wages",
  employee: "Employee deductions",
  employer: "Employer contributions",
  net: "Net pay",
} as const;

/** "QPP (employee)", "EI (employer)", "Net pay": unambiguous on its own. */
export function categoryLabel(key: PayrollCategory): string {
  const c = PAYROLL_CATEGORIES.find((x) => x.key === key)!;
  if (c.group === "employee" && key !== "ee_other") return `${c.label} (employee)`;
  if (c.group === "employer" && !["er_fss", "er_cnesst", "er_cnt", "er_other"].includes(key)) {
    return `${c.label} (employer)`;
  }
  if (key === "er_other") return "Other employer contributions";
  if (key === "ee_other") return "Other employee deductions";
  return c.label;
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

export const PROVIDER_LABEL: Record<PayrollProvider, string> = {
  nethris: "Nethris (Desjardins)",
  employeur_d: "Employeur D",
  adp_wfn: "ADP Workforce Now",
  ceridian_powerpay: "Ceridian Powerpay",
  other: "Other CSV (choose the columns)",
};
