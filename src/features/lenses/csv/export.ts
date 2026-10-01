import type { Locale } from "@/lib/i18n/config";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { localized } from "@/lib/query/catalog";
import type { LensResult, LensRow, LensValue } from "@/lib/query/run";
import { CSV_BOM } from "./parse";

/**
 * A lens result as CSV (Workspace OS U15). The engine already decided the
 * rows under the viewer's row-level security; this only lays them out:
 *
 * - RFC 4180 quoting, CRLF line ends, a UTF-8 byte-order mark so Excel reads
 *   accents (Montréal) without an import dialog;
 * - one column per shown property, headed by the property's name in the
 *   viewer's language, the title first;
 * - people, projects and programs by their name, never by id, so the file
 *   reads on its own and imports back by name;
 * - options (status, priority) by their label in the viewer's language;
 * - dates as YYYY-MM-DD, timestamps as the engine returns them;
 * - text that starts like a spreadsheet formula is neutralised (CSV injection).
 */

export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = String(value);
  // A leading =, +, - or @ would be run as a formula by Excel.
  // A plain number ("-5", "+2.5") is data, not a formula, and must import back as one.
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text) && !/^[-+]?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r;\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(fields: (string | number | boolean | null | undefined)[]): string {
  return fields.map(csvField).join(",");
}

function isRef(value: LensValue): value is { id: string; label: string | null } {
  return typeof value === "object" && value !== null && "id" in value;
}

/** The text one lens value exports as. */
export function exportValue(property: CatalogProperty | undefined, value: LensValue, locale: Locale): string {
  if (value === null || value === undefined) return "";
  if (isRef(value)) return value.label ?? "";
  if (property?.kind === "select" && property.choices && typeof value === "string") {
    const choice = property.choices.find((c) => c.key === value);
    if (choice) return localized(choice.label, locale);
  }
  if (property?.kind === "date" && typeof value === "string" && !property.timestamp) return value.slice(0, 10);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export interface CsvColumn {
  key: string;
  header: string;
  property: CatalogProperty | undefined;
}

/** Title first, then the requested fields (or every column the result has), in that order. */
export function csvColumns(result: LensResult, type: CatalogType | undefined, locale: Locale, fields?: string[]): CsvColumn[] {
  const byKey = new Map((type?.properties ?? []).map((p) => [p.key, p]));
  const title = byKey.get("title");
  const keys = (fields && fields.length > 0 ? fields : result.columns.map((c) => c.key)).filter(
    (k, i, all) => k !== "title" && all.indexOf(k) === i,
  );
  return [
    { key: "title", header: title ? localized(title.name, locale) : "Title", property: title },
    ...keys.map((key) => {
      const property = byKey.get(key);
      return { key, header: property ? localized(property.name, locale) : key, property };
    }),
  ];
}

export function rowFields(row: LensRow, columns: CsvColumn[], locale: Locale): string[] {
  return columns.map((c) => (c.key === "title" ? row.title : exportValue(c.property, row.values[c.key] ?? null, locale)));
}

/** The whole file, byte-order mark included. */
export function lensToCsv(result: LensResult, type: CatalogType | undefined, locale: Locale, fields?: string[]): string {
  const columns = csvColumns(result, type, locale, fields);
  const lines = [csvLine(columns.map((c) => c.header))];
  for (const row of result.rows) lines.push(csvLine(rowFields(row, columns, locale)));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** A safe attachment name: ascii, dashes, dated. */
export function csvFileName(parts: (string | null | undefined)[], date = new Date()): string {
  const slug = parts
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-")
    .slice(0, 60);
  return `${slug || "lens"}-${date.toISOString().slice(0, 10)}.csv`;
}
