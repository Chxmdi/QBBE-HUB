/**
 * A small, dependency-free PDF writer for generated letters, contracts and
 * acknowledgements (#147): plain paragraphs in Helvetica on Letter-size pages.
 *
 * Escaping is by construction. Every piece of text, template and merged
 * values alike, is written as a hexadecimal string (`<48656C6C6F>`), so no
 * character a record contains (parentheses, backslashes, line breaks,
 * "endstream", anything) can end the string or add PDF operators. Text is
 * encoded in WinAnsi, which covers English and French (é, è, à, ç, œ, «, », ’,
 * –, €); anything outside it is written as "?".
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const FONT_SIZE = 11;
const LEADING = 15;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LEADING);

/** Unicode code points that WinAnsi places in 0x80–0x9F. */
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** One character's WinAnsi byte; "?" when it has none. */
export function winAnsiByte(char: string): number {
  const code = char.codePointAt(0) ?? 0x3f;
  if (code === 0x202f || code === 0x2007) return 0x20; // narrow and figure spaces
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
  return WIN_ANSI_EXTRA[code] ?? 0x3f;
}

/** Helvetica advance widths (1/1000 em) for printable ASCII, from its AFM. */
const ASCII_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const OTHER_WIDTHS: Record<number, number> = {
  0x80: 556, 0x85: 1000, 0x8c: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333,
  0x95: 350, 0x96: 556, 0x97: 1000, 0x99: 1000, 0x9c: 944, 0xa0: 278, 0xab: 556, 0xbb: 556,
  0xc6: 1000, 0xe6: 889,
};

function charWidth(char: string): number {
  const byte = winAnsiByte(char);
  if (byte >= 0x20 && byte <= 0x7e) return ASCII_WIDTHS[byte - 0x20];
  if (OTHER_WIDTHS[byte]) return OTHER_WIDTHS[byte];
  // Accented letters are as wide as their base letter.
  const base = char.normalize("NFD")[0];
  if (base && base !== char && base.charCodeAt(0) < 0x7f) return ASCII_WIDTHS[base.charCodeAt(0) - 0x20];
  return 667;
}

/** Width of a line of text at the body size, in points. */
export function textWidth(text: string): number {
  let total = 0;
  for (const char of text) total += charWidth(char);
  return (total * FONT_SIZE) / 1000;
}

/** Breaks one paragraph into lines that fit the text width. */
export function wrapParagraph(paragraph: string): string[] {
  const words = paragraph.split(/ +/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate) <= TEXT_WIDTH) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A single word wider than the page is cut, never allowed to overflow.
    let rest = word;
    while (textWidth(rest) > TEXT_WIDTH) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut)) > TEXT_WIDTH) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  lines.push(line);
  return lines;
}

function hexWinAnsi(text: string): string {
  let hex = "";
  for (const char of text) hex += winAnsiByte(char).toString(16).padStart(2, "0");
  return `<${hex.toUpperCase()}>`;
}

/** A PDF text string for the document information dictionary (UTF-16BE). */
function hexUtf16(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i += 1) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

/** Lays the text out into pages of lines. Blank lines separate paragraphs. */
export function layoutPages(text: string): string[][] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    // Tabs and other control characters become spaces; they have no glyph.
    const paragraph = raw.replace(/[\u0000-\u001F\u007F]/g, " ").trimEnd();
    if (!paragraph.trim()) lines.push("");
    else lines.push(...wrapParagraph(paragraph));
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  return pages.length ? pages : [[""]];
}

/** Writes `text` as a PDF. `title` goes into the file's properties. */
export function renderTextPdf({ title, text }: { title: string; text: string }): Uint8Array {
  const pages = layoutPages(text);
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalog = add(""); // filled in below, once the page tree exists
  const pageTree = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${hexUtf16(title.slice(0, 200))} /Producer (QBBE Hub) >>`);

  const pageIds: number[] = [];
  for (const [index, lines] of pages.entries()) {
    const ops = [
      "BT",
      `/F1 ${FONT_SIZE} Tf`,
      `${LEADING} TL`,
      `${MARGIN} ${PAGE_HEIGHT - MARGIN - FONT_SIZE} Td`,
      ...lines.map((line, i) => `${i === 0 ? "" : "T* "}${hexWinAnsi(line)} Tj`),
      "ET",
    ];
    if (pages.length > 1) {
      const label = `${index + 1} / ${pages.length}`;
      ops.push(
        "BT",
        `/F1 9 Tf`,
        `${(PAGE_WIDTH - (textWidth(label) * 9) / FONT_SIZE) / 2} ${MARGIN / 2} Td`,
        `${hexWinAnsi(label)} Tj`,
        "ET",
      );
    }
    const stream = ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  // Every byte written is ASCII, so string length is byte length.
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
