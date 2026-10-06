/**
 * Year-end figures (#154): financial statements built from posted lines, the
 * accountant's import files, fiscal years and the thresholds of the annual
 * returns. Pure functions over integer cents so they can be tested without a
 * database. Balances arrive as debits minus credits.
 */
import {
  centsToDecimal,
  csvDocument,
  FUND_RESTRICTIONS,
  FUND_RESTRICTION_KEY,
  type AccountType,
  type FundRestriction,
} from "@/features/ledger/money";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

/** CSV text defaults to English, so spreadsheets and tests stay stable (#141). */
const EN = createTranslator("en");

export interface StatementTotalRow {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  fund_id: string;
  fund_code: string;
  fund_name: string;
  restriction: FundRestriction;
  opening_cents: number;
  movement_cents: number;
  closing_movement_cents: number;
  balance_cents: number;
}

/** An amount per restriction class plus the total. */
export type ByClass = Record<FundRestriction, number> & { total: number };

export interface StatementLine {
  code: string;
  name: string;
  amounts: ByClass;
}

export interface Statements {
  from: string;
  to: string;
  position: {
    assets: StatementLine[];
    liabilities: StatementLine[];
    totalAssets: number;
    totalLiabilities: number;
    /** Net assets by restriction class, as at `to`. */
    netAssets: ByClass;
  };
  operations: {
    revenue: StatementLine[];
    expenses: StatementLine[];
    totalRevenue: ByClass;
    totalExpenses: ByClass;
    excess: ByClass;
  };
  changes: {
    beginning: ByClass;
    excess: ByClass;
    /** Transfers between classes, recorded directly to net assets accounts. */
    direct: ByClass;
    ending: ByClass;
  };
  /** True when nothing at all was posted up to `to`. */
  empty: boolean;
}

export function emptyByClass(): ByClass {
  return { unrestricted: 0, internally_restricted: 0, externally_restricted: 0, total: 0 };
}

function add(target: ByClass, restriction: FundRestriction, cents: number) {
  target[restriction] += cents;
  target.total += cents;
}

function subtract(a: ByClass, b: ByClass): ByClass {
  const out = emptyByClass();
  for (const r of FUND_RESTRICTIONS) add(out, r, a[r] - b[r]);
  return out;
}

function sumByClass(parts: ByClass[]): ByClass {
  const out = emptyByClass();
  for (const p of parts) for (const r of FUND_RESTRICTIONS) add(out, r, p[r]);
  return out;
}

/** Groups rows into one line per account, with an amount per class. */
function linesFor(
  rows: StatementTotalRow[],
  type: AccountType,
  amount: (r: StatementTotalRow) => number,
): StatementLine[] {
  const byAccount = new Map<string, StatementLine>();
  for (const r of rows) {
    if (r.account_type !== type) continue;
    let line = byAccount.get(r.account_id);
    if (!line) {
      line = { code: r.code, name: r.name, amounts: emptyByClass() };
      byAccount.set(r.account_id, line);
    }
    add(line.amounts, r.restriction, amount(r));
  }
  return [...byAccount.values()]
    .filter((l) => FUND_RESTRICTIONS.some((c) => l.amounts[c] !== 0))
    .sort((a, b) => a.code.localeCompare(b.code));
}

const total = (lines: StatementLine[]) => sumByClass(lines.map((l) => l.amounts));

/**
 * The statement of financial position as at `to`, and the statements of
 * operations and changes in net assets for `from`..`to`, presented by
 * restriction class (the restricted fund presentation of ASNPO, Part III of
 * the CPA Canada Handbook). Closing entries are left out of operations: they
 * only move the year's result into net assets.
 */
export function buildStatements(rows: StatementTotalRow[], from: string, to: string): Statements {
  const assets = linesFor(rows, "asset", (r) => r.balance_cents);
  const liabilities = linesFor(rows, "liability", (r) => -r.balance_cents);
  const revenue = linesFor(rows, "revenue", (r) => -r.movement_cents);
  const expenses = linesFor(rows, "expense", (r) => r.movement_cents);

  const equityTypes = new Set<AccountType>(["net_assets", "revenue", "expense"]);
  const beginning = emptyByClass();
  const ending = emptyByClass();
  const direct = emptyByClass();
  for (const r of rows) {
    if (!equityTypes.has(r.account_type)) continue;
    add(beginning, r.restriction, -r.opening_cents);
    add(ending, r.restriction, -r.balance_cents);
    if (r.account_type === "net_assets") add(direct, r.restriction, -r.movement_cents);
  }

  const totalRevenue = total(revenue);
  const totalExpenses = total(expenses);
  const excess = subtract(totalRevenue, totalExpenses);

  return {
    from,
    to,
    position: {
      assets,
      liabilities,
      totalAssets: total(assets).total,
      totalLiabilities: total(liabilities).total,
      netAssets: ending,
    },
    operations: { revenue, expenses, totalRevenue, totalExpenses, excess },
    changes: { beginning, excess, direct, ending },
    empty: rows.every((r) => r.balance_cents === 0 && r.opening_cents === 0 && r.movement_cents === 0 && r.closing_movement_cents === 0),
  };
}

/** Whether a prior year has anything worth a comparative column. */
export function hasActivity(s: Statements): boolean {
  return !s.empty;
}

// ---------------------------------------------------------------------------
// CSV files
// ---------------------------------------------------------------------------

const classHeaders = (t: TranslateFn) => FUND_RESTRICTIONS.map((r) => t(FUND_RESTRICTION_KEY[r]));
const money = (cents: number) => centsToDecimal(cents);
const classCells = (a: ByClass) => [...FUND_RESTRICTIONS.map((r) => money(a[r])), money(a.total)];

/** Statement of financial position, one account per row, with an optional comparative. */
export function positionCsv(current: Statements, prior: Statements | null, t: TranslateFn = EN): string {
  const priorTotals = (lines: StatementLine[], code: string) =>
    prior ? money(lines.find((l) => l.code === code)?.amounts.total ?? 0) : null;
  const header = [
    t("finance.ledgerReports.csv.section"),
    t("finance.common.account"),
    t("finance.ledgerReports.name"),
    t("finance.ledgerReports.csv.asAt", { date: current.to }),
    ...(prior ? [t("finance.ledgerReports.csv.asAt", { date: prior.to })] : []),
  ];
  const rows: (string | number | null)[][] = [
    [t("finance.ledgerReports.csv.positionTitle", { date: current.to }), t("finance.ledgerReports.csv.notFiled")],
    header,
  ];
  const section = (label: string, lines: StatementLine[], priorLines: StatementLine[] | undefined) => {
    const codes = new Set([...lines.map((l) => l.code), ...(priorLines ?? []).map((l) => l.code)]);
    for (const code of [...codes].sort()) {
      const line = lines.find((l) => l.code === code) ?? priorLines?.find((l) => l.code === code);
      rows.push([
        label,
        code,
        line?.name ?? "",
        money(lines.find((l) => l.code === code)?.amounts.total ?? 0),
        ...(prior ? [priorTotals(priorLines ?? [], code)] : []),
      ]);
    }
  };
  const assets = t("finance.ledgerReports.statementTables.assets");
  const liabilities = t("finance.ledgerReports.statementTables.liabilities");
  const netAssets = t("finance.ledgerReports.statementTables.netAssets");
  section(assets, current.position.assets, prior?.position.assets);
  rows.push([
    assets,
    "",
    t("finance.ledgerReports.statementTables.totalAssets"),
    money(current.position.totalAssets),
    ...(prior ? [money(prior.position.totalAssets)] : []),
  ]);
  section(liabilities, current.position.liabilities, prior?.position.liabilities);
  rows.push([
    liabilities,
    "",
    t("finance.ledgerReports.statementTables.totalLiabilities"),
    money(current.position.totalLiabilities),
    ...(prior ? [money(prior.position.totalLiabilities)] : []),
  ]);
  for (const r of FUND_RESTRICTIONS) {
    rows.push([
      netAssets,
      "",
      t(FUND_RESTRICTION_KEY[r]),
      money(current.position.netAssets[r]),
      ...(prior ? [money(prior.position.netAssets[r])] : []),
    ]);
  }
  rows.push([
    netAssets,
    "",
    t("finance.ledgerReports.statementTables.totalNetAssets"),
    money(current.position.netAssets.total),
    ...(prior ? [money(prior.position.netAssets.total)] : []),
  ]);
  return csvDocument(rows);
}

/** Statement of operations and changes in net assets, by restriction class. */
export function operationsCsv(current: Statements, prior: Statements | null, t: TranslateFn = EN): string {
  const header = [
    t("finance.ledgerReports.csv.section"),
    t("finance.common.account"),
    t("finance.ledgerReports.name"),
    ...classHeaders(t),
    t("finance.common.total"),
    ...(prior ? [t("finance.ledgerReports.csv.totalRange", { from: prior.from, to: prior.to })] : []),
  ];
  const rows: (string | number | null)[][] = [
    [
      t("finance.ledgerReports.csv.operationsTitle", { from: current.from, to: current.to }),
      t("finance.ledgerReports.csv.notFiled"),
    ],
    header,
  ];
  const revenue = t("finance.ledgerReports.statementTables.revenue");
  const expenses = t("finance.ledgerReports.statementTables.expenses");
  const netAssets = t("finance.ledgerReports.statementTables.netAssets");
  const excess = t("finance.ledgerReports.statementTables.excess");
  const priorTotal = (lines: StatementLine[] | undefined, code: string) =>
    prior ? [money(lines?.find((l) => l.code === code)?.amounts.total ?? 0)] : [];
  for (const l of current.operations.revenue) {
    rows.push([revenue, l.code, l.name, ...classCells(l.amounts), ...priorTotal(prior?.operations.revenue, l.code)]);
  }
  rows.push([revenue, "", t("finance.ledgerReports.statementTables.totalRevenue"), ...classCells(current.operations.totalRevenue), ...(prior ? [money(prior.operations.totalRevenue.total)] : [])]);
  for (const l of current.operations.expenses) {
    rows.push([expenses, l.code, l.name, ...classCells(l.amounts), ...priorTotal(prior?.operations.expenses, l.code)]);
  }
  rows.push([expenses, "", t("finance.ledgerReports.statementTables.totalExpenses"), ...classCells(current.operations.totalExpenses), ...(prior ? [money(prior.operations.totalExpenses.total)] : [])]);
  rows.push([t("finance.ledgerReports.csv.result"), "", excess, ...classCells(current.operations.excess), ...(prior ? [money(prior.operations.excess.total)] : [])]);
  rows.push([netAssets, "", t("finance.ledgerReports.statementTables.netAssetsBeginning"), ...classCells(current.changes.beginning), ...(prior ? [money(prior.changes.beginning.total)] : [])]);
  rows.push([netAssets, "", excess, ...classCells(current.changes.excess), ...(prior ? [money(prior.changes.excess.total)] : [])]);
  rows.push([netAssets, "", t("finance.ledgerReports.csv.transfersDirect"), ...classCells(current.changes.direct), ...(prior ? [money(prior.changes.direct.total)] : [])]);
  rows.push([netAssets, "", t("finance.ledgerReports.statementTables.netAssetsEnd"), ...classCells(current.changes.ending), ...(prior ? [money(prior.changes.ending.total)] : [])]);
  return csvDocument(rows);
}

export interface ExportLine {
  entry_date: string;
  entry_number: number;
  entry_kind: string;
  line_no: number;
  account_code: string;
  account_name: string;
  fund_code: string;
  program_name: string | null;
  description: string;
  debit_cents: number;
  credit_cents: number;
}

/**
 * The general ledger as plain rows the accountant's software can import: one
 * header row, one row per posted line, no titles or totals.
 */
export function journalImportCsv(lines: ExportLine[]): string {
  return csvDocument([
    ["Date", "Entry no", "Account code", "Account name", "Fund", "Program", "Description", "Debit", "Credit"],
    ...lines.map((l) => [
      l.entry_date,
      l.entry_number,
      l.account_code,
      l.account_name,
      l.fund_code,
      l.program_name ?? "",
      l.description,
      l.debit_cents ? money(l.debit_cents) : "0.00",
      l.credit_cents ? money(l.credit_cents) : "0.00",
    ]),
  ]);
}

/** The trial balance as importable rows: one header row, one row per account. */
export function trialBalanceImportCsv(
  rows: { code: string; name: string; account_type: AccountType; balance_cents: number }[],
): string {
  return csvDocument([
    ["Account code", "Account name", "Type", "Debit", "Credit"],
    ...rows
      .filter((r) => r.balance_cents !== 0)
      .map((r) => [
        r.code,
        r.name,
        r.account_type,
        r.balance_cents > 0 ? money(r.balance_cents) : "0.00",
        r.balance_cents < 0 ? money(-r.balance_cents) : "0.00",
      ]),
  ]);
}

export interface ReceiptExportRow {
  document_date: string;
  kind: string;
  vendor: string;
  total_cents: number;
  gst_cents: number;
  qst_cents: number;
  status: string;
  scan_status: string;
  file_name: string;
}

export function receiptsCsv(rows: ReceiptExportRow[], t: TranslateFn = EN): string {
  return csvDocument([
    [
      t("finance.common.date"),
      t("finance.ledgerReports.csv.kind"),
      t("finance.common.vendor"),
      t("finance.common.total"),
      t("finance.common.gst"),
      t("finance.common.qst"),
      t("finance.ledgerReports.csv.reviewStatus"),
      t("finance.ledgerReports.receipts.file"),
      t("finance.ledgerReports.csv.fileAvailable"),
    ],
    ...rows.map((r) => [
      r.document_date,
      r.kind,
      r.vendor,
      money(r.total_cents),
      money(r.gst_cents),
      money(r.qst_cents),
      r.status,
      r.file_name,
      r.scan_status === "clean"
        ? t("finance.ledgerReports.csv.yes")
        : t("finance.ledgerReports.csv.noWithStatus", { status: r.scan_status }),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Fiscal years
// ---------------------------------------------------------------------------

export interface FiscalYear {
  startsOn: string;
  endsOn: string;
  label: string;
}

function addMonths(isoDate: string, months: number): string {
  const [y, m] = isoDate.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function fiscalYearFor(startsOn: string): FiscalYear {
  const endsOn = dayBefore(addMonths(startsOn, 12));
  return { startsOn, endsOn, label: `${startsOn.slice(0, 7)} to ${endsOn.slice(0, 7)}` };
}

/** The fiscal year before one, for comparatives and "preceding period" tests. */
export function priorFiscalYear(year: FiscalYear): FiscalYear {
  return fiscalYearFor(addMonths(year.startsOn, -12));
}

/**
 * Fiscal years are twelve-month runs from the first period, the way
 * `ledger_create_fiscal_year` creates them. Newest first.
 */
export function fiscalYearsFromPeriods(periods: { starts_on: string; ends_on: string }[]): FiscalYear[] {
  if (periods.length === 0) return [];
  const sorted = [...periods].sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const first = `${sorted[0].starts_on.slice(0, 7)}-01`;
  const last = sorted.at(-1)!.ends_on;
  const years: FiscalYear[] = [];
  for (let start = first; start <= last; start = addMonths(start, 12)) years.push(fiscalYearFor(start));
  return years.reverse();
}

// ---------------------------------------------------------------------------
// Annual returns
// ---------------------------------------------------------------------------

/**
 * T1044 thresholds, section 149(12) of the Income Tax Act as published by the
 * CRA (needs accountant review): an NPO files the T1044 when any one holds.
 */
export const T1044_THRESHOLDS = {
  /** Dividends, interest, rentals or royalties received or receivable in the fiscal period. */
  investmentIncomeCents: 10_000_00,
  /** Total assets at the end of the immediately preceding fiscal period. */
  priorYearAssetsCents: 200_000_00,
} as const;

/** Revenue accounts that look like dividends, interest, rentals or royalties. */
export function isInvestmentIncomeAccount(name: string): boolean {
  return /\b(interest|dividends?|rents?|rental|royalt\w*|int[ée]r[êe]ts?|loyers?|redevances?)\b/i.test(name);
}

export interface ReturnFigures {
  totalRevenue: number;
  totalExpenses: number;
  excess: number;
  totalAssets: number;
  totalLiabilities: number;
  netAssets: number;
  priorYearAssets: number | null;
  investmentIncome: number;
  investmentAccounts: string[];
  t1044: {
    investmentIncomeOver: boolean;
    priorAssetsOver: boolean | null;
    /** "likely" when a threshold is crossed; otherwise the accountant decides. */
    indication: "likely" | "check";
  };
}

export function returnFigures(current: Statements, prior: Statements | null): ReturnFigures {
  const investment = current.operations.revenue.filter((l) => isInvestmentIncomeAccount(l.name));
  const investmentIncome = investment.reduce((s, l) => s + l.amounts.total, 0);
  const priorYearAssets = prior && !prior.empty ? prior.position.totalAssets : null;
  const investmentIncomeOver = investmentIncome > T1044_THRESHOLDS.investmentIncomeCents;
  const priorAssetsOver = priorYearAssets === null ? null : priorYearAssets > T1044_THRESHOLDS.priorYearAssetsCents;
  return {
    totalRevenue: current.operations.totalRevenue.total,
    totalExpenses: current.operations.totalExpenses.total,
    excess: current.operations.excess.total,
    totalAssets: current.position.totalAssets,
    totalLiabilities: current.position.totalLiabilities,
    netAssets: current.position.netAssets.total,
    priorYearAssets,
    investmentIncome,
    investmentAccounts: investment.map((l) => `${l.code} ${l.name}`),
    t1044: {
      investmentIncomeOver,
      priorAssetsOver,
      indication: investmentIncomeOver || priorAssetsOver ? "likely" : "check",
    },
  };
}

/** The filing deadline most NPO returns share: six months after the year end. */
export function sixMonthsAfter(endsOn: string): string {
  const nextMonthStart = addMonths(endsOn, 1);
  return dayBefore(addMonths(nextMonthStart, 6));
}
