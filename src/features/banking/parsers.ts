import { parseMoneyToCents } from "@/features/finance/money";
import { bankEn } from "@/lib/i18n/messages/finance/bank.en";
import { interpolate, type MessageKey, type MessageVars, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Bank statement parsers (#151). Pure functions, shared by the server (which
 * parses the uploaded file) and the browser (which previews a CSV header for a
 * custom column mapping). Amounts are integer cents, positive for deposits and
 * negative for withdrawals; a value that could be read two ways is refused
 * rather than guessed, and the whole file with it.
 */

export interface StatementLine {
  postedOn: string; // YYYY-MM-DD
  amountCents: number;
  description: string;
  reference: string | null;
  /**
   * What makes this line itself, before hashing. The same line in a file
   * downloaded again gives the same key, so a second import skips it.
   */
  key: string;
}

export interface ParsedStatement {
  format: "csv" | "ofx";
  layout: string;
  lines: StatementLine[];
  /** From an OFX file: the closing balance the bank reported, if any. */
  ledgerBalance?: { cents: number; asOf: string } | null;
  /** From an OFX file: last four digits of the account, to check the upload. */
  accountLast4?: string | null;
}

/**
 * Why a file was refused, as a catalogue key (#141), so the screen can show it
 * in the reader's language. `keyVars` are placeholders whose values are
 * themselves catalogue keys (a bank's name, a layout hint).
 */
export interface ParseMessage {
  key: MessageKey;
  vars?: MessageVars;
  keyVars?: Record<string, MessageKey>;
}

/** `error` is the English text; `message` lets the screen translate it. */
export type ParseResult =
  | { ok: true; statement: ParsedStatement }
  | { ok: false; error: string; message?: ParseMessage };

type ParserText = keyof typeof bankEn.parsers;
type LayoutHint = Extract<ParserText, `hint${string}`>;

function fail(name: ParserText, vars?: MessageVars, keyVars?: Record<string, MessageKey>): ParseResult {
  const english: MessageVars = { ...vars };
  for (const [k, key] of Object.entries(keyVars ?? {})) {
    english[k] = lookupEnglish(key);
  }
  return {
    ok: false,
    error: interpolate(bankEn.parsers[name], english),
    message: { key: `finance.bank.parsers.${name}`, vars, keyVars },
  };
}

/** The English text of a `finance.bank.*` key, without loading every catalogue. */
function lookupEnglish(key: MessageKey): string {
  let node: unknown = bankEn;
  for (const part of key.replace(/^finance\.bank\./, "").split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return typeof node === "string" ? node : key;
}

/** A refusal in the reader's language, from the parser's message. */
export function translateParseError(t: TranslateFn, result: { error: string; message?: ParseMessage }): string {
  const m = result.message;
  if (!m) return result.error;
  const vars: MessageVars = { ...m.vars };
  for (const [k, key] of Object.entries(m.keyVars ?? {})) vars[k] = t(key);
  return t(m.key, vars);
}

export const MAX_LINES = 5000;

// ---------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------

/** Splits CSV text into rows (RFC 4180 quoting). The delimiter is , ; or tab. */
export function readCsv(text: string, delimiter?: string): string[][] {
  const body = text.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ""));
}

function detectDelimiter(text: string): string {
  const firstLines = text.split(/\r?\n/).slice(0, 5).join("\n");
  const count = (ch: string) => firstLines.split(ch).length - 1;
  const candidates: [string, number][] = [
    [",", count(",")],
    [";", count(";")],
    ["\t", count("\t")],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type DateOrder = "ymd" | "mdy" | "dmy";

/** "2026/10/05", "2026-10-05", "20261005", "10/05/2026" → "2026-10-05", or null. */
export function parseStatementDate(input: string, order: DateOrder): string | null {
  const text = input.trim().replace(/(?:T\d|\s).*$/, "");
  let y: number;
  let m: number;
  let d: number;
  // OFX dates: 20261005, 20261005120000, 20261005120000.000[-5:EST].
  const compact = /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?)?(?:\[[^\]]*\])?$/.exec(text);
  const parts = text.split(/[-/.]/);
  if (compact) {
    [y, m, d] = [Number(compact[1]), Number(compact[2]), Number(compact[3])];
  } else if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    const n = parts.map(Number);
    if (order === "ymd") [y, m, d] = n;
    else if (order === "mdy") [m, d, y] = n;
    else [d, m, y] = n;
    if (String(y).length !== 4) return null;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * A signed amount: "-12.34", "12,34-", "(12.34)", "+5", "1 234,56 $". Uses the
 * finance money parser for the digits, so the same ambiguous forms ("1,234")
 * are refused. Returns null when unreadable.
 */
export function parseSignedCents(input: string): number | null {
  let text = input.trim().replace(/^CAD\s*|\s*CAD$/i, "");
  if (text === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/^[-−]/.test(text)) {
    negative = !negative;
    text = text.slice(1);
  } else if (/^\+/.test(text)) {
    text = text.slice(1);
  } else if (/-$/.test(text)) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  const cents = parseMoneyToCents(text);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

export function normalizeDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// CSV layouts
// ---------------------------------------------------------------------------

/** A column by 0-based position. */
export interface CsvMapping {
  dateColumn: number;
  dateOrder: DateOrder;
  descriptionColumns: number[];
  /** One signed column, or separate withdrawal and deposit columns. */
  amount: { kind: "signed"; column: number; negate?: boolean } | { kind: "split"; withdrawal: number; deposit: number };
  referenceColumn?: number | null;
  /** Rows to skip at the top (a header, a preamble). */
  skipRows: number;
}

export interface CsvPreset {
  id: string;
  label: string;
  institution: "desjardins" | "national_bank" | "rbc" | "td" | "bmo";
  /** Finds the header row (if any) and returns the mapping for this file. */
  resolve: (rows: string[][]) => CsvMapping | LayoutHint;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .trim();

/** Finds the first row within the first ten that has every wanted header. */
function findHeader(rows: string[][], wanted: string[][]): { index: number; cols: number[] } | null {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const cells = rows[r].map(norm);
    const cols = wanted.map((alts) => cells.findIndex((c) => alts.includes(c)));
    if (cols.every((c) => c >= 0)) return { index: r, cols };
  }
  return null;
}

/**
 * Layouts of the banks QBBE is most likely to use, from their public export
 * formats. Each is checked against the file's shape and says what it expected
 * when the file does not fit, so a wrong choice is refused, not misread.
 */
export const CSV_PRESETS: CsvPreset[] = [
  {
    // AccèsD "Relevé" export: no header. Columns: caisse, folio, account type,
    // date (YYYY/MM/DD), transaction no., description, cheque no., withdrawal,
    // deposit, …, balance.
    id: "desjardins",
    label: "Desjardins (AccèsD)",
    institution: "desjardins",
    resolve: (rows) => {
      const ok = rows.length > 0 && rows.every((r) => r.length >= 9 && parseStatementDate(r[3], "ymd") !== null);
      if (!ok) return "hintDesjardins";
      return {
        dateColumn: 3,
        dateOrder: "ymd",
        descriptionColumns: [5],
        amount: { kind: "split", withdrawal: 7, deposit: 8 },
        referenceColumn: 6,
        skipRows: 0,
      };
    },
  },
  {
    // Header: Date;Description;Catégorie;Débit;Crédit;Solde (YYYY-MM-DD).
    id: "national_bank",
    label: "National Bank",
    institution: "national_bank",
    resolve: (rows) => {
      const h = findHeader(rows, [["date"], ["description"], ["debit", "withdrawal"], ["credit", "deposit"]]);
      if (!h) return "hintNationalBank";
      return {
        dateColumn: h.cols[0],
        dateOrder: "ymd",
        descriptionColumns: [h.cols[1]],
        amount: { kind: "split", withdrawal: h.cols[2], deposit: h.cols[3] },
        skipRows: h.index + 1,
      };
    },
  },
  {
    // Header: Account Type,Account Number,Transaction Date,Cheque Number,
    // Description 1,Description 2,CAD$,USD$ (M/D/YYYY, signed CAD$).
    id: "rbc",
    label: "RBC Royal Bank",
    institution: "rbc",
    resolve: (rows) => {
      const h = findHeader(rows, [
        ["transaction date"],
        ["description 1"],
        ["description 2"],
        ["cad$", "cad"],
        ["cheque number"],
      ]);
      if (!h) return "hintRbc";
      return {
        dateColumn: h.cols[0],
        dateOrder: "mdy",
        descriptionColumns: [h.cols[1], h.cols[2]],
        amount: { kind: "signed", column: h.cols[3] },
        referenceColumn: h.cols[4],
        skipRows: h.index + 1,
      };
    },
  },
  {
    // No header: date (MM/DD/YYYY), description, withdrawal, deposit, balance.
    id: "td",
    label: "TD Canada Trust",
    institution: "td",
    resolve: (rows) => {
      const ok = rows.length > 0 && rows.every((r) => r.length >= 4 && parseStatementDate(r[0], "mdy") !== null);
      if (!ok) return "hintTd";
      return {
        dateColumn: 0,
        dateOrder: "mdy",
        descriptionColumns: [1],
        amount: { kind: "split", withdrawal: 2, deposit: 3 },
        skipRows: 0,
      };
    },
  },
  {
    // A preamble line, then: First Bank Card,Transaction Type,Date Posted,
    // Transaction Amount,Description (YYYYMMDD, signed amount).
    id: "bmo",
    label: "BMO Bank of Montreal",
    institution: "bmo",
    resolve: (rows) => {
      const h = findHeader(rows, [["date posted"], ["transaction amount"], ["description"]]);
      if (!h) return "hintBmo";
      return {
        dateColumn: h.cols[0],
        dateOrder: "ymd",
        descriptionColumns: [h.cols[2]],
        amount: { kind: "signed", column: h.cols[1] },
        skipRows: h.index + 1,
      };
    },
  },
];

export function presetById(id: string): CsvPreset | undefined {
  return CSV_PRESETS.find((p) => p.id === id);
}

function cell(row: string[], index: number | null | undefined): string {
  return index === null || index === undefined || index < 0 ? "" : (row[index] ?? "");
}

/** Applies a mapping to CSV rows. Any unreadable row refuses the whole file. */
export function parseCsvRows(rows: string[][], mapping: CsvMapping, layout: string): ParseResult {
  const body = rows.slice(mapping.skipRows);
  if (body.length === 0) return fail("noLines");
  if (body.length > MAX_LINES) return fail("tooManyLines", { max: MAX_LINES });
  const lines: StatementLine[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < body.length; i++) {
    const row = body[i];
    const rowNo = i + mapping.skipRows + 1;
    const postedOn = parseStatementDate(cell(row, mapping.dateColumn), mapping.dateOrder);
    if (!postedOn) return fail("rowNotDate", { row: rowNo, value: cell(row, mapping.dateColumn) });
    let amountCents: number | null;
    if (mapping.amount.kind === "signed") {
      amountCents = parseSignedCents(cell(row, mapping.amount.column));
      if (amountCents !== null && mapping.amount.negate) amountCents = -amountCents;
    } else {
      const out = cell(row, mapping.amount.withdrawal);
      const inn = cell(row, mapping.amount.deposit);
      const outCents = out === "" ? 0 : parseSignedCents(out);
      const inCents = inn === "" ? 0 : parseSignedCents(inn);
      amountCents =
        outCents === null || inCents === null ? null : inCents - outCents;
    }
    if (amountCents === null) {
      return fail("rowAmount", { row: rowNo });
    }
    if (amountCents === 0) continue; // information rows, e.g. a zero-amount notice
    const description = normalizeDescription(
      mapping.descriptionColumns.map((c) => cell(row, c)).filter(Boolean).join(" "),
    ).slice(0, 500);
    const reference = normalizeDescription(cell(row, mapping.referenceColumn)).slice(0, 100) || null;
    const base = ["csv", postedOn, amountCents, description.toLowerCase(), reference ?? ""].join("|");
    // Two identical lines on one day (two $5 charges) stay two lines: the
    // second carries its position among the identical ones.
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    lines.push({ postedOn, amountCents, description: description || "(no description)", reference, key: `${base}|${occurrence}` });
  }
  if (lines.length === 0) return fail("noLines");
  return { ok: true, statement: { format: "csv", layout, lines } };
}

export function parseCsvStatement(text: string, layout: string, custom?: CsvMapping): ParseResult {
  const rows = readCsv(text);
  if (rows.length === 0) return fail("empty");
  if (layout === "custom") {
    if (!custom) return fail("chooseColumns");
    return parseCsvRows(rows, custom, "custom");
  }
  const preset = presetById(layout);
  if (!preset) return fail("chooseLayout");
  const mapping = preset.resolve(rows);
  if (typeof mapping === "string") {
    return fail("wrongLayout", undefined, {
      bank: `finance.bank.presets.${preset.institution}`,
      hint: `finance.bank.parsers.${mapping}`,
    });
  }
  return parseCsvRows(rows, mapping, preset.id);
}

// ---------------------------------------------------------------------------
// OFX / QFX (version 1 SGML and version 2 XML)
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** The value of <TAG> in an OFX block, closed or not (SGML leaves it open). */
function ofxValue(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return match ? decodeEntities(match[1].trim()) : null;
}

export function parseOfxStatement(text: string): ParseResult {
  if (!/<OFX>/i.test(text)) return fail("notOfx");
  const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)].map((m) => m[1]);
  if (blocks.length === 0) return fail("noLines");
  if (blocks.length > MAX_LINES) return fail("tooManyLines", { max: MAX_LINES });
  const lines: StatementLine[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const postedOn = parseStatementDate(ofxValue(b, "DTPOSTED") ?? "", "ymd");
    if (!postedOn) return fail("transactionDate", { number: i + 1 });
    const amountCents = parseSignedCents(ofxValue(b, "TRNAMT") ?? "");
    if (amountCents === null) {
      return fail("transactionAmount", { number: i + 1 });
    }
    if (amountCents === 0) continue;
    const name = ofxValue(b, "NAME") ?? "";
    const memo = ofxValue(b, "MEMO") ?? "";
    const description =
      normalizeDescription([name, memo && memo !== name ? memo : ""].filter(Boolean).join(" ")).slice(0, 500) ||
      "(no description)";
    const fitid = ofxValue(b, "FITID");
    const reference = (ofxValue(b, "CHECKNUM") || fitid || "").slice(0, 100) || null;
    // The bank's own transaction id identifies the line across downloads.
    let key: string;
    if (fitid) {
      key = ["ofx", fitid].join("|");
    } else {
      const base = ["ofx-nofitid", postedOn, amountCents, description.toLowerCase()].join("|");
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      key = `${base}|${occurrence}`;
    }
    lines.push({ postedOn, amountCents, description, reference, key });
  }
  if (lines.length === 0) return fail("noLines");

  const balBlock = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i.exec(text)?.[1] ?? "";
  const balCents = balBlock ? parseSignedCents(ofxValue(balBlock, "BALAMT") ?? "") : null;
  const balAsOf = balBlock ? parseStatementDate(ofxValue(balBlock, "DTASOF") ?? "", "ymd") : null;
  const acct = ofxValue(text, "ACCTID");
  return {
    ok: true,
    statement: {
      format: "ofx",
      layout: "ofx",
      lines,
      ledgerBalance: balCents !== null && balAsOf ? { cents: balCents, asOf: balAsOf } : null,
      accountLast4: acct && /\d{4}$/.test(acct) ? acct.slice(-4) : null,
    },
  };
}

/** Picks the parser from the file name and content. */
export function parseStatementFile(
  fileName: string,
  text: string,
  layout: string,
  custom?: CsvMapping,
): ParseResult {
  const looksOfx = /\.(ofx|qfx)$/i.test(fileName) || /^\s*(OFXHEADER|<\?xml[\s\S]{0,200}<\?OFX|<OFX>)/i.test(text);
  if (looksOfx) return parseOfxStatement(text);
  return parseCsvStatement(text, layout, custom);
}
