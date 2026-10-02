import type { EditorBlock } from "@/features/editor/adapter/content";
import { MAX_SAVE_CHARS } from "@/features/editor/queue/queue";
import { hasRichStructure, htmlToBlocks, parseHtml, sanitizeHtml, type HtmlNode } from "./html";
import { looksLikeMarkdown, markdownToBlocks } from "./markdown";
import { isSpreadsheetText, tsvToTable } from "./table";

/**
 * What a paste does, decided from the clipboard alone so it can be tested
 * without a browser. The editor then carries the plan out (units/e1-paste).
 */

export interface PastedFile {
  name: string;
  type: string;
  size: number;
}

export interface ClipboardInput {
  /** The clipboard's types, in the order the browser lists them. */
  types: readonly string[];
  /** The clipboard's data for one type ("" when absent). */
  getData: (type: string) => string;
  files: readonly PastedFile[];
  /** The cursor is in a code block, which keeps pasted text as it is. */
  inCode: boolean;
  /** How large the document already is, as the save queue counts it. */
  documentChars: number;
}

export type PastePlan =
  /** Leave the paste to the editor's own handling (code into a code block). */
  | { kind: "default" }
  /** The editor's own copied blocks, cleaned. */
  | { kind: "internal"; html: string }
  | { kind: "blocks"; blocks: EditorBlock[]; source: "html" | "markdown" | "table" | "text" }
  | { kind: "files" }
  /** More than the editor can save: nothing is inserted. */
  | { kind: "tooLarge" }
  | { kind: "nothing" };

/**
 * A paste is counted twice: once as the document's content and once as its
 * saved collaboration state (base64, a third larger than the text it holds).
 */
export const PASTE_STATE_FACTOR = 7 / 3;

/** HTML larger than this is not read; its plain text is used instead. */
export const MAX_HTML_CHARS = MAX_SAVE_CHARS * 8;

/** Whether adding this much content would take the document past what it can save. */
export function exceedsLimit(documentChars: number, pastedChars: number): boolean {
  return documentChars + Math.ceil(pastedChars * PASTE_STATE_FACTOR) > MAX_SAVE_CHARS;
}

function visibleText(node: HtmlNode): string {
  if (node.kind === "text") return node.text;
  return node.children.map(visibleText).join("");
}

function blocksPlan(blocks: EditorBlock[], source: "html" | "markdown" | "table" | "text", documentChars: number): PastePlan {
  if (blocks.length === 0) return { kind: "nothing" };
  if (exceedsLimit(documentChars, JSON.stringify(blocks).length)) return { kind: "tooLarge" };
  return { kind: "blocks", blocks, source };
}

/** Decides what a paste does. */
export function planPaste(input: ClipboardInput): PastePlan {
  const has = (type: string) => input.types.includes(type);
  const text = has("text/plain") ? input.getData("text/plain") : "";
  // Text larger than the limit can never fit, whatever its form; it is
  // refused before it is read, so a huge paste cannot freeze the page.
  if (text.length > MAX_SAVE_CHARS) return { kind: "tooLarge" };

  // Text into a code block stays as it is. Without text (a copied image, or
  // HTML alone) the paste is read like anywhere else, so it is still cleaned
  // and files still go through the scanned upload.
  if (input.inCode && text) {
    if (exceedsLimit(input.documentChars, text.length)) return { kind: "tooLarge" };
    return { kind: "default" };
  }

  const rawHtml = has("text/html") ? input.getData("text/html") : "";
  const html = rawHtml.length > MAX_HTML_CHARS ? "" : rawHtml;
  if (rawHtml.length > MAX_HTML_CHARS && !text.trim()) return { kind: "tooLarge" };

  const htmlText = html ? visibleText(parseHtml(html)).trim() : "";
  if (input.files.length > 0 && !text.trim() && !htmlText) return { kind: "files" };

  if (has("blocknote/html")) {
    const internal = input.getData("blocknote/html");
    if (internal.length > MAX_HTML_CHARS) return { kind: "tooLarge" };
    const clean = sanitizeHtml(internal);
    if (exceedsLimit(input.documentChars, clean.length)) return { kind: "tooLarge" };
    return { kind: "internal", html: clean };
  }
  if (has("vscode-editor-data") && text) {
    if (exceedsLimit(input.documentChars, text.length)) return { kind: "tooLarge" };
    return { kind: "default" };
  }
  if (has("text/markdown")) {
    const markdown = input.getData("text/markdown");
    if (markdown.length > MAX_SAVE_CHARS) return { kind: "tooLarge" };
    return blocksPlan(markdownToBlocks(markdown), "markdown", input.documentChars);
  }
  if (html && htmlText) {
    // A spreadsheet's HTML holds its table; other HTML wins over Markdown-looking
    // text only when it carries structure (a code editor's HTML is just colours).
    if (hasRichStructure(html) || !looksLikeMarkdown(text)) {
      if (!(isSpreadsheetText(text) && !/<table[\s>]/i.test(html))) {
        return blocksPlan(htmlToBlocks(html), "html", input.documentChars);
      }
    }
  }
  if (isSpreadsheetText(text)) return blocksPlan([tsvToTable(text)], "table", input.documentChars);
  if (text.trim()) return blocksPlan(markdownToBlocks(text), looksLikeMarkdown(text) ? "markdown" : "text", input.documentChars);
  if (input.files.length > 0) return { kind: "files" };
  return { kind: "nothing" };
}
