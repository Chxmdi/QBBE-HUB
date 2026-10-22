import { csvField, csvLine } from "@/features/lenses/csv/export";
import { CSV_BOM } from "@/features/lenses/csv/parse";
import type { TranslateFn } from "@/lib/i18n/translate";
import { snapshotSections } from "./snapshot-view";

/**
 * One report snapshot as a spreadsheet (P0-RPT-04).
 *
 * Every cell goes through the shared `csvField`, the same one the other CSV
 * exports use: task, blocker, decision, risk and milestone titles are text
 * members typed, and one that starts like a formula (=, +, -, @, tab or
 * carriage return) is written with a leading apostrophe so Excel or
 * LibreOffice shows it instead of running it (SEC-028). A UTF-8 byte-order
 * mark and CRLF line ends let Excel open accented French text directly.
 */
export interface ReportCsvInput {
  title: string;
  version: number;
  generatedAt: string;
  snapshot: Record<string, unknown>;
  t: TranslateFn;
}

export function buildReportCsv({ title, version, generatedAt, snapshot, t }: ReportCsvInput): string {
  const rows: string[] = [];
  rows.push(csvField(`# ${title}`));
  // The generation time stays an ISO timestamp: a spreadsheet reads it as one.
  rows.push(csvField(t("reports.csvExported", { version, at: generatedAt })));
  rows.push("");

  // The header is fixed catalogue text with its own commas: written as is.
  rows.push(t("reports.csvHeader"));
  const metrics = (snapshot.metrics ?? {}) as Record<string, number | string>;
  for (const [key, value] of Object.entries(metrics)) {
    rows.push(csvLine([t("reports.csvMetric"), key, value, ""]));
  }

  // Section names and wording follow the reader's language; stored dates stay
  // as recorded so a spreadsheet can sort them.
  for (const section of snapshotSections(snapshot, { t })) {
    const name = section.title.toLowerCase();
    if (section.rows.length === 0) {
      rows.push(csvLine([name, "", t("reports.noneInSnapshot"), ""]));
      continue;
    }
    for (const row of section.rows) {
      rows.push(csvLine([name, row.primary, row.secondary ?? "", ""]));
    }
  }

  return `${CSV_BOM}${rows.join("\r\n")}\r\n`;
}
