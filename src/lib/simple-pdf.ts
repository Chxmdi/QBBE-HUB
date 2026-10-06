/**
 * Minimal PDF 1.4 writer for frozen report snapshots. No third-party
 * dependency — the bytes are determined only by the snapshot text passed
 * in, so an approved report stays byte-stable if live data later changes.
 */

import { winAnsiByte } from "@/features/documents/templates/pdf";

/**
 * The text as WinAnsi, one character per byte: the encoding the standard
 * Helvetica font reads. Writing UTF-8 instead turned French accents (and the
 * dash) into two or three garbage glyphs each.
 */
function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) out += String.fromCharCode(winAnsiByte(char));
  return out;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(text: string, max = 92): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export interface PdfSection {
  heading: string;
  lines: string[];
}

/**
 * `generatedLine` is the line under the title, in the reader's language; it
 * defaults to the English wording.
 */
export function buildSimplePdf(
  title: string,
  generatedAt: string,
  sections: PdfSection[],
  generatedLine = `Generated ${generatedAt} — frozen snapshot (RPT-001)`,
): Uint8Array {
  const contentLines: string[] = [];
  let y = 780;
  const push = (text: string, size = 11) => {
    if (y < 60) {
      // Single-page reports at pilot scale; extra lines clip rather than
      // invent a multi-page layout that would change byte stability later.
      return;
    }
    contentLines.push(`BT /F1 ${size} Tf 48 ${y} Td (${escapePdf(toWinAnsi(text).slice(0, 200))}) Tj ET`);
    y -= size + 6;
  };

  push(title, 16);
  push(generatedLine, 9);
  y -= 8;
  for (const section of sections) {
    y -= 4;
    push(section.heading, 13);
    for (const line of section.lines) {
      for (const wrapped of wrapLine(line)) push(wrapped, 10);
    }
  }

  const stream = contentLines.join("\n");
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
  );
  objects.push(
    `4 0 obj << /Length ${Buffer.byteLength(stream, "latin1")} >> stream\n${stream}\nendstream endobj\n`,
  );
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
