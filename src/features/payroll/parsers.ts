import {
  parseSignedCents,
  parseStatementDate,
  readCsv,
  type DateOrder,
} from "@/features/banking/parsers";
import {
  CATEGORY_KEYS,
  categoryLabel,
  emptyCents,
  employeeDeductions,
  totalsAddUp,
  type PayrollCategory,
  type PayrollProvider,
  type RunCents,
} from "@/features/payroll/categories";
import { formatCents } from "@/features/finance/money";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Payroll journal and register parsers (#155). Pure functions that run in the
 * browser: the file never leaves the person's computer. Only the columns
 * mapped below are read. Employee names, social insurance numbers and every
 * other column are never looked at, and per-employee rows are added into
 * their run's totals and then dropped. What comes out is run-level totals.
 *
 * Amounts use the finance money parser: a value that could be read two ways
 * ("1,234") is refused, and the whole file with it, rather than guessed.
 */

export type PayrollField = "payDate" | "periodStart" | "periodEnd" | "runReference" | PayrollCategory;

export const REQUIRED_FIELDS: PayrollField[] = ["payDate", "periodStart", "periodEnd", "gross_wages", "net_pay"];

/** Categories where several columns may add together (union dues, RRSP...). */
const MULTI_COLUMN: PayrollField[] = ["ee_other", "er_other"];

const DATE_FIELDS = ["payDate", "periodStart", "periodEnd", "runReference"] as const;

export function fieldLabel(field: PayrollField, t: TranslateFn): string {
  return (DATE_FIELDS as readonly string[]).includes(field)
    ? t(`finance.payroll.fields.${field as (typeof DATE_FIELDS)[number]}`)
    : categoryLabel(field as PayrollCategory, t);
}

export interface RunTotals {
  runReference: string | null;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  cents: RunCents;
  /** Per-employee rows read into this run and discarded. Shown, never stored. */
  rowsRead: number;
}

export interface ParsedPayroll {
  provider: PayrollProvider;
  runs: RunTotals[];
  /** Categories the file has no column for; they are imported as zero. */
  missing: PayrollCategory[];
  /** Total rows in the file that were checked against the sum of the lines. */
  totalRowsChecked: number;
}

export type PayrollParseResult = { ok: true; payroll: ParsedPayroll } | { ok: false; error: string };

export interface PayrollMapping {
  /** 0-based index of the header row. */
  headerRow: number;
  /** How dates that are not YYYY-MM-DD are written. */
  dateOrder: DateOrder;
  /** 0-based column indexes per field. */
  columns: Partial<Record<PayrollField, number[]>>;
}

export const MAX_RUNS = 100;
export const MAX_ROWS = 20000;

export const normalizeHeader = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface PayrollPreset {
  id: Exclude<PayrollProvider, "other">;
  label: string;
  /** Order of dates not written YYYY-MM-DD. */
  dateOrder: DateOrder;
  /** Normalized header names per field, provider-specific first. */
  headers: Partial<Record<PayrollField, string[]>>;
}

/** Headers found in more than one provider's export, French and English. */
const COMMON: Partial<Record<PayrollField, string[]>> = {
  payDate: ["pay date", "date de paie", "date du paiement", "date de paiement", "cheque date", "payment date"],
  periodStart: ["period start", "period start date", "debut de periode", "periode du", "date de debut"],
  periodEnd: ["period end", "period end date", "fin de periode", "periode au", "date de fin"],
  runReference: ["run number", "pay run", "payroll number", "no de paie", "numero de paie"],
  gross_wages: ["gross pay", "gross earnings", "gross wages", "salaire brut", "gains bruts", "brut"],
  ee_federal_tax: ["federal income tax", "federal tax", "impot federal"],
  ee_quebec_tax: ["quebec income tax", "qc income tax", "provincial income tax", "provincial tax", "impot du quebec", "impot quebec", "impot provincial"],
  ee_qpp: ["qpp employee", "qpp ee", "rrq employe", "rrq salarie", "rrq", "qpp"],
  ee_ei: ["ei employee", "ei ee", "ae employe", "ae salarie", "assurance emploi", "ae", "ei"],
  ee_qpip: ["qpip employee", "qpip ee", "rqap employe", "rqap salarie", "rqap", "qpip"],
  ee_other: ["other deductions", "autres retenues", "retenues diverses"],
  er_qpp: ["qpp employer", "qpp er", "employer qpp", "rrq employeur"],
  er_ei: ["ei employer", "ei er", "employer ei", "ae employeur"],
  er_qpip: ["qpip employer", "qpip er", "employer qpip", "rqap employeur"],
  er_fss: ["hsf", "qc hsf", "health services fund", "fss", "fonds des services de sante"],
  er_cnesst: ["cnesst", "cnesst employeur"],
  er_cnt: ["cnt", "labour standards", "normes du travail"],
  er_other: ["other employer contributions", "autres cotisations employeur"],
  net_pay: ["net pay", "salaire net", "paie nette", "net a payer", "net"],
};

function withCommon(own: Partial<Record<PayrollField, string[]>>): Partial<Record<PayrollField, string[]>> {
  const out: Partial<Record<PayrollField, string[]>> = {};
  for (const field of Object.keys(COMMON) as PayrollField[]) {
    out[field] = [...new Set([...(own[field] ?? []), ...(COMMON[field] ?? [])])];
  }
  return out;
}

/**
 * Layouts from each provider's public documentation of its payroll journal or
 * register export. NOT YET CHECKED AGAINST A REAL EXPORT: each preset refuses
 * a file whose headers it does not recognise, and "Other CSV" maps any file
 * by hand.
 */
export const PAYROLL_PRESETS: PayrollPreset[] = [
  {
    id: "nethris",
    label: "Nethris (Desjardins)",
    dateOrder: "ymd",
    headers: withCommon({
      payDate: ["date de paie"],
      periodStart: ["debut de periode"],
      periodEnd: ["fin de periode"],
      runReference: ["no de paie"],
      gross_wages: ["salaire brut"],
      net_pay: ["salaire net"],
    }),
  },
  {
    id: "employeur_d",
    label: "Employeur D",
    dateOrder: "dmy",
    headers: withCommon({
      payDate: ["date de versement", "date de paie"],
      periodStart: ["periode debut", "debut de periode"],
      periodEnd: ["periode fin", "fin de periode"],
      runReference: ["numero de paie"],
      gross_wages: ["brut"],
      ee_quebec_tax: ["impot quebec"],
      net_pay: ["net a payer"],
    }),
  },
  {
    id: "adp_wfn",
    label: "ADP Workforce Now",
    dateOrder: "mdy",
    headers: withCommon({
      payDate: ["pay date", "check date"],
      periodStart: ["period start date", "period beginning date"],
      periodEnd: ["period end date", "period ending date"],
      runReference: ["payroll number", "payroll id"],
      gross_wages: ["gross pay"],
      ee_quebec_tax: ["qc income tax"],
      er_fss: ["qc hsf"],
      net_pay: ["net pay"],
    }),
  },
  {
    id: "ceridian_powerpay",
    label: "Ceridian Powerpay",
    dateOrder: "ymd",
    headers: withCommon({
      payDate: ["cheque date", "pay date"],
      periodStart: ["period start"],
      periodEnd: ["period end"],
      runReference: ["pay run", "run no"],
      gross_wages: ["gross earnings"],
      ee_ei: ["ei premium"],
      ee_qpip: ["qpip premium"],
      er_qpp: ["employer qpp"],
      er_ei: ["employer ei"],
      er_qpip: ["employer qpip"],
      er_fss: ["hsf"],
      er_cnesst: ["wcb cnesst", "cnesst"],
      net_pay: ["net pay"],
    }),
  },
];

export function presetById(id: string): PayrollPreset | undefined {
  return PAYROLL_PRESETS.find((p) => p.id === id);
}

const ALL_FIELDS: PayrollField[] = ["payDate", "periodStart", "periodEnd", "runReference", ...CATEGORY_KEYS];

/**
 * Columns whose header matches each field. A single-column field matched by
 * two columns is ambiguous and returned as a message.
 */
function matchHeaders(
  header: string[],
  aliases: Partial<Record<PayrollField, string[]>>,
  t: TranslateFn,
): Partial<Record<PayrollField, number[]>> | string {
  const cells = header.map(normalizeHeader);
  const columns: Partial<Record<PayrollField, number[]>> = {};
  const taken = new Set<number>();
  for (const field of ALL_FIELDS) {
    const names = aliases[field] ?? [];
    // First alias that matches wins: specific names before generic ones.
    for (const name of names) {
      const found = cells.flatMap((c, i) => (c === name && !taken.has(i) ? [i] : []));
      if (found.length === 0) continue;
      if (found.length > 1 && !MULTI_COLUMN.includes(field)) {
        return t("finance.payroll.parse.twoColumns", { header: header[found[0]], field: fieldLabel(field, t) });
      }
      columns[field] = found;
      found.forEach((i) => taken.add(i));
      if (!MULTI_COLUMN.includes(field)) break;
    }
  }
  return columns;
}

/** Finds the header row (within the first 15) and maps it for a preset. */
export function resolvePreset(
  rows: string[][],
  preset: PayrollPreset,
  t: TranslateFn = createTranslator("en"),
): PayrollMapping | string {
  let lastError: string | null = null;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const columns = matchHeaders(rows[r], preset.headers, t);
    if (typeof columns === "string") {
      lastError = columns;
      continue;
    }
    if (REQUIRED_FIELDS.every((f) => (columns[f]?.length ?? 0) > 0)) {
      return { headerRow: r, dateOrder: preset.dateOrder, columns };
    }
  }
  return (
    lastError ??
    t("finance.payroll.parse.expectedHeader", { fields: REQUIRED_FIELDS.map((f) => fieldLabel(f, t)).join(", ") })
  );
}

/** Best guess of a mapping for "Other CSV", for the person to check. */
export function guessMapping(header: string[]): Partial<Record<PayrollField, number[]>> {
  // The message for an ambiguous header is dropped here, so its language does not matter.
  const columns = matchHeaders(header, COMMON, createTranslator("en"));
  return typeof columns === "string" ? {} : columns;
}

/** The header row a generic file most likely has: the first with 3+ cells. */
export function guessHeaderRow(rows: string[][]): number {
  const index = rows.slice(0, 15).findIndex((r) => r.filter((c) => c.trim() !== "").length >= 3);
  return Math.max(0, index);
}

// ---------------------------------------------------------------------------
// Reading rows into run totals
// ---------------------------------------------------------------------------

function readDate(value: string, order: DateOrder): string | null {
  const text = value.trim();
  // ISO dates are never ambiguous, whatever the provider's usual order.
  return /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(text) || /^\d{8}$/.test(text)
    ? parseStatementDate(text, "ymd")
    : parseStatementDate(text, order);
}

const TOTAL_ROW = /^(grand )?(sous )?(total|totaux|total general|totals)\b/;

function isTotalRow(row: string[]): boolean {
  return row.some((c) => TOTAL_ROW.test(normalizeHeader(c)));
}

interface Accumulator {
  runReference: string | null;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  cents: RunCents;
  rowsRead: number;
}

const runKey = (a: { payDate: string; periodStart: string; periodEnd: string; runReference: string | null }) =>
  [a.payDate, a.periodStart, a.periodEnd, (a.runReference ?? "").toLowerCase()].join("|");

export function parsePayrollRows(
  rows: string[][],
  mapping: PayrollMapping,
  provider: PayrollProvider,
  locale: Locale = "en",
): PayrollParseResult {
  const t = createTranslator(locale);
  const header = rows[mapping.headerRow] ?? [];
  const body = rows.slice(mapping.headerRow + 1);
  if (body.length === 0) return { ok: false, error: t("finance.payroll.parse.noLines") };
  if (body.length > MAX_ROWS) return { ok: false, error: t("finance.payroll.parse.maxRows", { max: MAX_ROWS }) };
  for (const field of REQUIRED_FIELDS) {
    if (!mapping.columns[field]?.length) {
      return { ok: false, error: t("finance.payroll.parse.chooseColumn", { field: fieldLabel(field, t) }) };
    }
  }
  const col = (field: PayrollField) => mapping.columns[field] ?? [];
  const cell = (row: string[], i: number) => (row[i] ?? "").trim();
  const headerName = (i: number) => header[i] || t("finance.payroll.parse.columnFallback", { number: i + 1 });

  const details = new Map<string, Accumulator>();
  const totals: Accumulator[] = [];

  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    const rowNo = mapping.headerRow + i + 2;
    const total = isTotalRow(row);

    const cents = emptyCents();
    let anyAmount = false;
    for (const key of CATEGORY_KEYS) {
      for (const c of col(key)) {
        const text = cell(row, c);
        if (text === "") continue;
        const value = parseSignedCents(text);
        if (value === null) {
          return {
            ok: false,
            error: t("finance.payroll.parse.notAmount", { row: rowNo, column: headerName(c), text }),
          };
        }
        cents[key] += value;
        anyAmount = true;
      }
    }
    if (!anyAmount) continue; // a blank or section-title row

    const dates = {
      payDate: readDate(cell(row, col("payDate")[0]), mapping.dateOrder),
      periodStart: readDate(cell(row, col("periodStart")[0]), mapping.dateOrder),
      periodEnd: readDate(cell(row, col("periodEnd")[0]), mapping.dateOrder),
    };
    const runReference = col("runReference").length ? cell(row, col("runReference")[0]) || null : null;

    if (total) {
      // A total row without its dates can still be checked when the file
      // holds a single run.
      const dated = Boolean(dates.payDate && dates.periodStart && dates.periodEnd);
      totals.push({
        payDate: dated ? dates.payDate! : "",
        periodStart: dated ? dates.periodStart! : "",
        periodEnd: dated ? dates.periodEnd! : "",
        runReference,
        cents,
        rowsRead: 0,
      });
      continue;
    }
    for (const [field, value] of Object.entries(dates) as [PayrollField, string | null][]) {
      if (!value) {
        const text = cell(row, col(field)[0]);
        return {
          ok: false,
          error: t("finance.payroll.parse.notDate", { row: rowNo, field: fieldLabel(field, t).toLowerCase(), text }),
        };
      }
    }
    const run = {
      payDate: dates.payDate!,
      periodStart: dates.periodStart!,
      periodEnd: dates.periodEnd!,
      runReference,
    };
    const key = runKey(run);
    const acc = details.get(key) ?? { ...run, cents: emptyCents(), rowsRead: 0 };
    for (const k of CATEGORY_KEYS) acc.cents[k] += cents[k];
    acc.rowsRead += 1;
    details.set(key, acc);
  }

  let runs: Accumulator[];
  let checked = 0;
  if (details.size > 0) {
    runs = [...details.values()];
    // A total row the file carries must equal the sum of its lines.
    for (const total of totals) {
      // Matched on its dates: a total row's run-number cell often says "Total".
      const sameDates = runs.filter(
        (r) =>
          total.payDate &&
          r.payDate === total.payDate &&
          r.periodStart === total.periodStart &&
          r.periodEnd === total.periodEnd,
      );
      const target = !total.payDate
        ? runs.length === 1
          ? runs[0]
          : undefined
        : (details.get(runKey(total)) ?? (sameDates.length === 1 ? sameDates[0] : undefined));
      if (!target) continue;
      const differs = CATEGORY_KEYS.find((k) => target.cents[k] !== total.cents[k]);
      if (differs) {
        return {
          ok: false,
          error: t("finance.payroll.parse.totalMismatch", {
            category: categoryLabel(differs, t),
            fileTotal: formatCents(total.cents[differs], locale),
            sum: formatCents(target.cents[differs], locale),
            date: target.payDate,
          }),
        };
      }
      checked += 1;
    }
  } else {
    // A register that holds only run totals.
    runs = totals.filter((t) => t.payDate);
    if (runs.length === 0) return { ok: false, error: t("finance.payroll.parse.noPayDate") };
  }

  if (runs.length > MAX_RUNS) return { ok: false, error: t("finance.payroll.errors.maxRuns", { max: MAX_RUNS }) };
  for (const run of runs) {
    const negative = CATEGORY_KEYS.find((k) => run.cents[k] < 0);
    if (negative) {
      return {
        ok: false,
        error: t("finance.payroll.parse.negative", { date: run.payDate, category: categoryLabel(negative, t) }),
      };
    }
    if (run.cents.gross_wages <= 0) {
      return { ok: false, error: t("finance.payroll.parse.noGross", { date: run.payDate }) };
    }
    if (run.periodStart > run.periodEnd) {
      return { ok: false, error: t("finance.payroll.parse.periodOrder", { date: run.payDate }) };
    }
    if (!totalsAddUp(run.cents)) {
      return {
        ok: false,
        error: t("finance.payroll.parse.doesNotAddUp", {
          date: run.payDate,
          gross: formatCents(run.cents.gross_wages, locale),
          deductions: formatCents(employeeDeductions(run.cents), locale),
          net: formatCents(run.cents.net_pay, locale),
        }),
      };
    }
  }

  runs.sort((a, b) => a.payDate.localeCompare(b.payDate) || a.periodStart.localeCompare(b.periodStart));
  return {
    ok: true,
    payroll: {
      provider,
      runs: runs.map((r) => ({
        runReference: r.runReference,
        payDate: r.payDate,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        cents: r.cents,
        rowsRead: r.rowsRead,
      })),
      missing: CATEGORY_KEYS.filter((k) => !mapping.columns[k]?.length),
      totalRowsChecked: checked,
    },
  };
}

/** Parses a payroll export with a provider preset, or with a hand mapping. */
export function parsePayrollFile(
  text: string,
  provider: PayrollProvider,
  custom?: PayrollMapping,
  locale: Locale = "en",
): PayrollParseResult {
  const t = createTranslator(locale);
  const rows = readCsv(text);
  if (rows.length === 0) return { ok: false, error: t("finance.payroll.parse.empty") };
  if (provider === "other") {
    if (!custom) return { ok: false, error: t("finance.payroll.parse.chooseEachColumn") };
    return parsePayrollRows(rows, custom, "other", locale);
  }
  const preset = presetById(provider);
  if (!preset) return { ok: false, error: t("finance.payroll.errors.chooseProvider") };
  const mapping = resolvePreset(rows, preset, t);
  if (typeof mapping === "string") {
    return { ok: false, error: t("finance.payroll.parse.notPreset", { provider: preset.label, reason: mapping }) };
  }
  return parsePayrollRows(rows, mapping, preset.id, locale);
}

export { readCsv };
