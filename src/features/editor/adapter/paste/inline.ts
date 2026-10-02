import type { InlineContent, InlineLink, InlineText } from "@/features/editor/adapter/content";

/**
 * Inline content built from pasted text: runs of text with styles, and links
 * whose address has passed `safeHref`. Shared by the HTML and Markdown
 * readers so both produce the same shape the editor stores.
 */

export type InlineStyles = Partial<Record<"bold" | "italic" | "underline" | "strike" | "code", true>>;

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * The address a pasted link may keep, or null. Only web, mail and phone
 * addresses, and addresses on this site, are kept: `javascript:`, `data:`,
 * `vbscript:`, `file:` and anything else is dropped, including when hidden
 * behind control characters, white space or entities the browser would ignore.
 */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  // Browsers skip control characters and white space inside a scheme
  // ("java\tscript:"), so the check reads the address the same way.
  const href = raw.replace(/[\u0000- \u007f-\u009f]/g, "");
  if (!href || href.length > 2048) return null;
  const scheme = SCHEME.exec(href);
  if (scheme) return ALLOWED_SCHEMES.has(scheme[1].toLowerCase()) ? href : null;
  // No scheme: a path or anchor on this site. "//host" is another site's
  // address without a scheme, and a colon before any slash could still be
  // read as a scheme, so both are refused.
  if (href.startsWith("//") || href.startsWith("\\")) return null;
  if (/^[^/?#]*:/.test(href)) return null;
  return href.startsWith("/") || href.startsWith("#") ? href : null;
}

function sameStyles(a: InlineText["styles"], b: InlineText["styles"]): boolean {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((key) => (a ?? {})[key] === (b ?? {})[key]);
}

function textRun(text: string, styles: InlineStyles): InlineText {
  return { type: "text", text, styles: { ...styles } };
}

/** Appends text, merged with the previous run when the styles match. */
export function pushText(list: InlineContent[], text: string, styles: InlineStyles = {}) {
  if (!text) return;
  const last = list[list.length - 1];
  if (last && last.type === "text" && sameStyles((last as InlineText).styles, styles)) {
    (last as InlineText).text += text;
    return;
  }
  list.push(textRun(text, styles));
}

/** Appends a link (or, for an unsafe address, its plain text). */
export function pushLink(list: InlineContent[], href: string | null | undefined, parts: InlineText[]) {
  const safe = safeHref(href);
  const content = parts.filter((part) => part.text);
  if (content.length === 0) return;
  if (!safe) {
    for (const part of content) pushText(list, part.text, (part.styles ?? {}) as InlineStyles);
    return;
  }
  const link: InlineLink = { type: "link", href: safe, content: content.map((part) => textRun(part.text, (part.styles ?? {}) as InlineStyles)) };
  list.push(link);
}

/** Trims white space at both ends of a run list, dropping runs left empty. */
export function trimInline(list: InlineContent[]): InlineContent[] {
  const out = list.map((item) => (item.type === "link" ? { ...item, content: (item as InlineLink).content.map((part) => ({ ...part })) } : { ...item }));
  const edge = (index: number, side: "start" | "end") => {
    const item = out[index];
    const runs = item.type === "link" ? (item as InlineLink).content : [item as InlineText];
    const run = side === "start" ? runs[0] : runs[runs.length - 1];
    if (!run) return;
    run.text = side === "start" ? run.text.replace(/^[ \t\n]+/, "") : run.text.replace(/[ \t\n]+$/, "");
  };
  while (out.length) {
    edge(0, "start");
    if (inlineLength(out[0]) > 0) break;
    out.shift();
  }
  while (out.length) {
    edge(out.length - 1, "end");
    if (inlineLength(out[out.length - 1]) > 0) break;
    out.pop();
  }
  return out.map((item) => (item.type === "link" ? { ...item, content: (item as InlineLink).content.filter((part) => part.text) } : item));
}

function inlineLength(item: InlineContent): number {
  if (item.type === "link") return (item as InlineLink).content.reduce((n, part) => n + part.text.length, 0);
  return typeof (item as InlineText).text === "string" ? (item as InlineText).text.length : 1;
}

/** The plain text of inline content. */
export function inlinePlainText(list: InlineContent[]): string {
  return list
    .map((item) => (item.type === "link" ? (item as InlineLink).content.map((part) => part.text).join("") : ((item as InlineText).text ?? "")))
    .join("");
}
