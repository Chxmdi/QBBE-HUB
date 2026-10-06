/**
 * Pure helpers for the words read out of files (#147). Kept free of browser
 * APIs so unit tests and the server share them.
 */

/** The database keeps at most this many characters of a file's text. */
export const MAX_TEXT_LENGTH = 200_000;

/**
 * Tidies text read out of a file: no control characters other than line
 * breaks, no runs of spaces, no more than one blank line in a row, and at
 * most MAX_TEXT_LENGTH characters. The database cleans it again; this keeps
 * what is sent small.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/** Search result snippets mark matches with these, never with markup. */
export const MATCH_START = "\u0002";
export const MATCH_END = "\u0003";

/**
 * "a \u0002word\u0003 here" → [{ text: "a " }, { text: "word", match: true },
 * { text: " here" }], for rendering as React text nodes: the stored text is
 * never interpreted as HTML.
 */
export function splitSnippet(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest.length) {
    const start = rest.indexOf(MATCH_START);
    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(MATCH_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    const word = rest.slice(start + 1, stop);
    if (word) parts.push({ text: word, match: true });
    rest = end === -1 ? "" : rest.slice(end + 1);
  }
  // Stray markers never reach the page.
  return parts
    .map((p) => ({ ...p, text: p.text.replaceAll(MATCH_START, "").replaceAll(MATCH_END, "") }))
    .filter((p) => p.text.length > 0);
}
