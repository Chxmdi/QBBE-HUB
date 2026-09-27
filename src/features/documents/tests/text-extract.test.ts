import { describe, expect, it } from "vitest";
import pdfjsPackage from "pdfjs-dist/package.json";
import { canReadFileText, PDF_VERSION } from "../text-extract/read-file-text";
import {
  MATCH_END,
  MATCH_START,
  MAX_TEXT_LENGTH,
  normalizeExtractedText,
  splitSnippet,
} from "../text-extract/text";

describe("file text for search", () => {
  it("pins the PDF reader the browser loads to the installed version", () => {
    // scripts/copy-ocr-assets.mjs copies the worker under the installed
    // version; the browser asks for PDF_VERSION. They must be the same.
    expect(PDF_VERSION).toBe(pdfjsPackage.version);
  });

  it("reads PDFs and photos, and nothing it cannot", () => {
    expect(canReadFileText({ type: "application/pdf", name: "a.pdf" })).toBe(true);
    expect(canReadFileText({ type: "", name: "scan.PDF" })).toBe(true);
    expect(canReadFileText({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(canReadFileText({ type: "image/svg+xml", name: "a.svg" })).toBe(false);
    expect(canReadFileText({ type: "application/zip", name: "a.zip" })).toBe(false);
  });

  it("tidies extracted text and caps its length", () => {
    expect(normalizeExtractedText("  a\t\tb \r\n\n\n\n c\u0007d  ")).toBe("a b\n\nc d");
    expect(normalizeExtractedText("x".repeat(MAX_TEXT_LENGTH + 10)).length).toBe(MAX_TEXT_LENGTH);
  });

  it("splits a snippet into plain text and matched words, never markup", () => {
    const snippet = `before ${MATCH_START}toner${MATCH_END} and <b>${MATCH_START}x${MATCH_END}`;
    expect(splitSnippet(snippet)).toEqual([
      { text: "before ", match: false },
      { text: "toner", match: true },
      { text: " and <b>", match: false },
      { text: "x", match: true },
    ]);
    expect(splitSnippet(`${MATCH_START}unterminated`)).toEqual([{ text: "unterminated", match: true }]);
    expect(splitSnippet(`stray ${MATCH_END} end`)).toEqual([{ text: "stray  end", match: false }]);
  });
});
