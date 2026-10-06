import { describe, expect, it } from "vitest";
import {
  findPlaceholders,
  formatLongDate,
  formatMoney,
  generatedTitle,
  mergeTemplate,
  placeholdersFor,
  unknownPlaceholders,
} from "../templates/merge";
import { layoutPages, renderTextPdf, textWidth, winAnsiByte, wrapParagraph } from "../templates/pdf";

const decode = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const hexOf = (text: string) =>
  Array.from(text)
    .map((c) => winAnsiByte(c).toString(16).padStart(2, "0").toUpperCase())
    .join("");

describe("template placeholders", () => {
  it("lists what a body uses, once each, in order", () => {
    expect(findPlaceholders("Dear {{ person.name }}, {{today}} {{person.name}}")).toEqual([
      "person.name",
      "today",
    ]);
  });

  it("refuses fields the record type cannot fill", () => {
    expect(unknownPlaceholders("{{gift.amount}} {{person.name}}", "member")).toEqual(["gift.amount"]);
    expect(unknownPlaceholders("{{gift.amount}} {{donor.name}} {{today}}", "gift")).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats integer cents in English and French", () => {
    expect(formatMoney(123456, "en")).toBe("$1,234.56");
    expect(formatMoney(123456, "fr")).toBe("1 234,56 $");
    expect(formatMoney(5, "en")).toBe("$0.05");
    expect(formatMoney(-2500, "fr")).toBe("-25,00 $");
    expect(() => formatMoney(1.5, "en")).toThrow();
  });

  it("formats dates in English and French", () => {
    expect(formatLongDate("2026-09-27", "en")).toBe("September 27, 2026");
    expect(formatLongDate("2026-09-27", "fr")).toBe("27 septembre 2026");
    expect(formatLongDate("2026-08-01", "fr")).toBe("1er août 2026");
    expect(formatLongDate("not a date", "en")).toBe("not a date");
  });
});

describe("mergeTemplate", () => {
  const allowed = placeholdersFor("gift");

  it("fills names, amounts and dates in the template's language", () => {
    const out = mergeTemplate(
      "Merci {{donor.name}} pour {{gift.amount}} reçu le {{gift.date}}.",
      {
        "donor.name": { kind: "text", value: "Aïcha Traoré" },
        "gift.amount": { kind: "money", cents: 25000 },
        "gift.date": { kind: "date", value: "2026-03-01" },
      },
      "fr",
      allowed,
    );
    expect(out).toBe("Merci Aïcha Traoré pour 250,00 $ reçu le 1er mars 2026.");
  });

  it("merges in one pass: a value that looks like a placeholder stays literal", () => {
    const out = mergeTemplate(
      "Dear {{donor.name}}, {{gift.number}}",
      {
        "donor.name": { kind: "text", value: "{{gift.number}}" },
        "gift.number": { kind: "text", value: "12" },
      },
      "en",
      allowed,
    );
    expect(out).toBe("Dear {{gift.number}}, 12");
  });

  it("keeps a merged value on one line", () => {
    const out = mergeTemplate(
      "Dear {{donor.name}}.",
      { "donor.name": { kind: "text", value: "Jane\n\nP.S. forged paragraph\u0007" } },
      "en",
      allowed,
    );
    expect(out).toBe("Dear Jane P.S. forged paragraph.");
  });

  it("refuses a placeholder the record cannot fill instead of leaving it", () => {
    expect(() => mergeTemplate("{{person.email}}", {}, "en", allowed)).toThrow(/Unknown placeholder/);
  });

  it("leaves a known field with no value empty", () => {
    expect(mergeTemplate("[{{gift.description}}]", {}, "en", allowed)).toBe("[]");
  });

  it("titles a generated document after the template and the record", () => {
    expect(generatedTitle("Thank-you letter", "Jane Doe")).toBe("Thank-you letter – Jane Doe");
    expect(generatedTitle("x".repeat(300), "y").length).toBe(200);
  });
});

describe("renderTextPdf", () => {
  it("writes a well-formed PDF whose cross-reference offsets point at its objects", () => {
    const pdf = decode(renderTextPdf({ title: "Letter", text: "Hello\n\nWorld" }));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it("escapes every merged value: nothing a record contains can end a string or add operators", () => {
    const hostile = "Evil) Tj /F1 99 Tf (x\\) endstream endobj";
    const pdf = decode(renderTextPdf({ title: hostile, text: `Dear ${hostile}` }));
    // The text only ever appears hex-encoded.
    expect(pdf).not.toContain("Evil");
    expect(pdf).not.toContain("/F1 99 Tf");
    expect(pdf).toContain(`<${hexOf(`Dear ${hostile}`)}>`);
    expect(pdf.match(/endstream/g)?.length).toBe(1);
  });

  it("encodes French in WinAnsi and never writes bytes outside it", () => {
    expect(winAnsiByte("é")).toBe(0xe9);
    expect(winAnsiByte("œ")).toBe(0x9c);
    expect(winAnsiByte("’")).toBe(0x92);
    expect(winAnsiByte("€")).toBe(0x80);
    expect(winAnsiByte(" ")).toBe(0x20);
    expect(winAnsiByte("漢")).toBe(0x3f);
  });

  it("wraps paragraphs to the page and cuts a word too long to fit", () => {
    const lines = wrapParagraph("word ".repeat(200).trim());
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(textWidth(line)).toBeLessThanOrEqual(468);
    for (const line of wrapParagraph("W".repeat(500))) expect(textWidth(line)).toBeLessThanOrEqual(468);
  });

  it("starts a new page when one is full", () => {
    const pages = layoutPages(Array.from({ length: 120 }, (_, i) => `Line ${i}`).join("\n"));
    expect(pages.length).toBe(3);
    const pdf = decode(renderTextPdf({ title: "Long", text: pages.flat().join("\n") }));
    expect(pdf).toContain("/Count 3");
  });
});
