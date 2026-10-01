/**
 * CSV reading for the import wizard (Workspace OS U15). Pure, shared by the
 * browser (preview) and the server (the import itself), so both read a file
 * the same way.
 *
 * RFC 4180: fields may be quoted, a quote inside a quoted field is doubled,
 * and a quoted field may span lines. Lines end in CRLF or LF. A leading
 * byte-order mark (what Excel writes) is ignored, and the delimiter is read
 * from the header line: comma, semicolon (Excel in French Canada) or tab.
 */

export const CSV_BOM = "﻿";

export const DELIMITERS = [",", ";", "\t"] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export interface ParsedCsv {
  delimiter: Delimiter;
  headers: string[];
  /** Data rows, each padded or cut to the header's width. Blank rows are dropped. */
  rows: string[][];
}

/** The delimiter that splits the first line into the most fields. */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best: Delimiter = ",";
  let bestCount = -1;
  for (const delimiter of DELIMITERS) {
    const count = countOutsideQuotes(firstLine, delimiter);
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted) count += 1;
  }
  return count;
}

/** Splits CSV text into records. Fields keep their inner whitespace; unquoted fields are trimmed. */
export function splitCsv(text: string, delimiter?: Delimiter): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(body);
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let wasQuoted = false;
  const endField = () => {
    record.push(wasQuoted ? field : field.trim());
    field = "";
    wasQuoted = false;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      wasQuoted = true;
      field = "";
    } else if (c === sep) {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i += 1;
      endField();
      records.push(record);
      record = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || wasQuoted || record.length > 0) {
    endField();
    records.push(record);
  }
  return records.filter((r) => r.some((f) => f !== ""));
}

/** The header line plus data rows squared to its width. */
export function parseCsv(text: string, delimiter?: Delimiter): ParsedCsv {
  const sep = delimiter ?? detectDelimiter(text.startsWith(CSV_BOM) ? text.slice(1) : text);
  const [header = [], ...rest] = splitCsv(text, sep);
  const seen = new Map<string, number>();
  const headers = header.map((h, i) => {
    const base = h.trim() === "" ? `column_${i + 1}` : h.trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    // A second "Notes" column keeps its own name, so a mapping keyed by header is unambiguous.
    return n === 1 ? base : `${base} (${n})`;
  });
  const width = headers.length;
  const rows = rest.map((r) => {
    const row = r.slice(0, width);
    while (row.length < width) row.push("");
    return row;
  });
  return { delimiter: sep, headers, rows };
}
