/**
 * Suggested edits (V1-17): replacing one stretch of a block's text.
 */

export interface TextSuggestion {
  start: number;
  end: number;
  originalText: string;
  proposedText: string;
}

export type ApplyResult = { ok: true; text: string } | { ok: false; reason: "changed" | "ambiguous" };

/**
 * Applies a suggestion to the block's current text. When the text moved
 * since the suggestion was made, the original words are looked for again:
 * found exactly once, they are replaced there; otherwise nothing is guessed.
 */
export function applySuggestion(text: string, suggestion: TextSuggestion): ApplyResult {
  const { start, end, originalText, proposedText } = suggestion;
  if (text.slice(start, end) === originalText) {
    return { ok: true, text: text.slice(0, start) + proposedText + text.slice(end) };
  }
  if (originalText.length === 0) return { ok: false, reason: "changed" };
  const first = text.indexOf(originalText);
  if (first < 0) return { ok: false, reason: "changed" };
  if (text.indexOf(originalText, first + 1) >= 0) return { ok: false, reason: "ambiguous" };
  return { ok: true, text: text.slice(0, first) + proposedText + text.slice(first + originalText.length) };
}

/** A selection anchor for a comment, or null when the selection is empty or out of range. */
export function selectionAnchor(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; quote: string } | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) {
    return null;
  }
  const quote = text.slice(start, end).slice(0, 500);
  return quote.trim() ? { start, end: start + quote.length, quote } : null;
}
