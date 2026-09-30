import { describe, expect, it } from "vitest";
import { applySuggestion, selectionAnchor } from "../suggestions";

describe("applying a suggestion", () => {
  const suggestion = { start: 9, end: 15, originalText: "spring", proposedText: "autumn" };

  it("replaces the range when the text is unchanged", () => {
    expect(applySuggestion("Plan the spring gala.", suggestion)).toEqual({ ok: true, text: "Plan the autumn gala." });
  });

  it("finds the words again when the text moved", () => {
    expect(applySuggestion("Please plan the spring gala.", suggestion)).toEqual({
      ok: true,
      text: "Please plan the autumn gala.",
    });
  });

  it("refuses to guess when the words are gone or appear twice", () => {
    expect(applySuggestion("Plan the summer gala.", suggestion)).toEqual({ ok: false, reason: "changed" });
    expect(applySuggestion("A spring gala, spring fair.", suggestion)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("can remove text", () => {
    expect(applySuggestion("Plan the spring gala.", { ...suggestion, start: 8, originalText: " spring", proposedText: "" })).toEqual({
      ok: true,
      text: "Plan the gala.",
    });
  });
});

describe("selection anchors", () => {
  it("quotes the selected text", () => {
    expect(selectionAnchor("Plan the spring gala.", 9, 15)).toEqual({ start: 9, end: 15, quote: "spring" });
  });

  it("refuses empty, blank or out-of-range selections", () => {
    expect(selectionAnchor("abc", 1, 1)).toBeNull();
    expect(selectionAnchor("a   b", 1, 4)).toBeNull();
    expect(selectionAnchor("abc", 2, 9)).toBeNull();
    expect(selectionAnchor("abc", -1, 2)).toBeNull();
  });

  it("caps long quotes at 500 characters", () => {
    const text = "x".repeat(800);
    expect(selectionAnchor(text, 0, 800)).toEqual({ start: 0, end: 500, quote: "x".repeat(500) });
  });
});
