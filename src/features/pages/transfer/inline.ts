import type { InlineContent, InlineLink, InlineText } from "@/features/editor/adapter/content";

/**
 * Inline text shared by the Markdown and HTML converters (wave 2 unit X1).
 * Only the styles both formats can carry round-trip: bold, italic,
 * strikethrough and inline code, plus links to web and mail addresses.
 */

export type Styles = { bold?: true; italic?: true; strike?: true; code?: true };
export const STYLE_KEYS = ["bold", "italic", "strike", "code"] as const;

/** Link targets an imported or exported page may carry; anything else (javascript:, data:) is dropped. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!/^(https?:\/\/|mailto:)/i.test(href)) return null;
  // Control characters and spaces never belong in a link we keep.
  for (let i = 0; i < href.length; i++) {
    const code = href.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return null;
  }
  return href;
}

function sameStyles(a: InlineText["styles"], b: InlineText["styles"]): boolean {
  const ka = Object.keys(a ?? {}).sort();
  const kb = Object.keys(b ?? {}).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a![k] === b![k]);
}

export function text(value: string, styles: Styles = {}): InlineText {
  return Object.keys(styles).length ? { type: "text", text: value, styles: { ...styles } } : { type: "text", text: value };
}

/** Joins neighbouring runs with the same styles and drops empty ones. */
export function mergeRuns(items: InlineContent[]): InlineContent[] {
  const out: InlineContent[] = [];
  for (const item of items) {
    if (item.type === "text") {
      const run = item as InlineText;
      if (run.text === "") continue;
      const last = out[out.length - 1];
      if (last && last.type === "text" && sameStyles((last as InlineText).styles, run.styles)) {
        out[out.length - 1] = { ...(last as InlineText), text: (last as InlineText).text + run.text };
        continue;
      }
      out.push(run);
    } else if (item.type === "link") {
      const link = item as InlineLink;
      const content = mergeRuns(link.content) as InlineText[];
      if (content.length) out.push({ type: "link", href: link.href, content });
    } else {
      out.push(item);
    }
  }
  return out;
}

/** Collapses runs of whitespace (not hard breaks) the way a browser reads HTML text. */
export function trimRuns(items: InlineContent[]): InlineContent[] {
  const runs = mergeRuns(items);
  const first = runs[0];
  if (first?.type === "text") runs[0] = { ...(first as InlineText), text: (first as InlineText).text.replace(/^[ \t]+/, "") };
  const lastIndex = runs.length - 1;
  const last = runs[lastIndex];
  if (last?.type === "text") runs[lastIndex] = { ...(last as InlineText), text: (last as InlineText).text.replace(/[ \t]+$/, "") };
  return mergeRuns(runs);
}

/** The plain text of inline content. */
export function plain(items: InlineContent[]): string {
  return items
    .map((item) => {
      if (item.type === "text") return (item as InlineText).text;
      if (item.type === "link") return (item as InlineLink).content.map((c) => c.text).join("");
      const value = (item as { text?: unknown }).text;
      return typeof value === "string" ? value : "";
    })
    .join("");
}
