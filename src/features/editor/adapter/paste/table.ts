import type { EditorBlock, InlineContent } from "@/features/editor/adapter/content";
import { pushText } from "./inline";

/**
 * Cells copied from a spreadsheet arrive as tab-separated text: one row per
 * line, a tab between cells, and a cell holding a tab, a line break or a quote
 * wrapped in double quotes (with quotes doubled), as Excel, Google Sheets and
 * LibreOffice write them.
 */

/** Rows and cells of tab-separated text. A final line break ends the last row, not a new one. */
export function parseTsv(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;
  while (i < source.length) {
    const char = source[i];
    if (atCellStart && char === '"') {
      // A quoted cell runs to the next quote not doubled.
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j += 1;
          break;
        }
        value += source[j];
        j += 1;
      }
      // Only a closed quote directly followed by a tab, a line break or the
      // end is a quoted cell; otherwise the quote is just text.
      if (closed && (j === source.length || source[j] === "\t" || source[j] === "\n")) {
        cell = value;
        i = j;
        atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (char === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else {
      cell += char;
    }
    i += 1;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * Whether plain text is cells from a spreadsheet: it holds a tab and every
 * row has the same number of cells (at least two).
 */
export function isSpreadsheetText(text: string): boolean {
  if (!text.includes("\t")) return false;
  const rows = parseTsv(text);
  const width = rows[0]?.length ?? 0;
  return width >= 2 && rows.every((row) => row.length === width);
}

export type TableCell = { type: "tableCell"; content: InlineContent[] };

/** A table block from rows of cells, short rows padded so every row has the same columns. */
export function tableBlock(rows: InlineContent[][][]): EditorBlock {
  const width = Math.max(1, ...rows.map((row) => row.length));
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((row) => ({
        cells: Array.from({ length: width }, (_, index): TableCell => ({ type: "tableCell", content: row[index] ?? [] })),
      })),
    },
  };
}

/** A table block from tab-separated text. A line break inside a cell stays in the cell. */
export function tsvToTable(text: string): EditorBlock {
  return tableBlock(
    parseTsv(text).map((row) =>
      row.map((value) => {
        const content: InlineContent[] = [];
        pushText(content, value);
        return content;
      }),
    ),
  );
}
