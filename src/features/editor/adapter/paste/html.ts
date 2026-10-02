import type { EditorBlock, InlineContent, InlineText } from "@/features/editor/adapter/content";
import { pushLink, pushText, safeHref, trimInline, type InlineStyles } from "./inline";
import { codeLanguage } from "./shortcuts";
import { tableBlock } from "./table";

/**
 * Pasted HTML, read without a browser document: a small tokenizer builds a
 * tree, and only known tags become structure. Scripts, styles, frames,
 * embedded objects and forms are dropped with their content; event handlers,
 * inline styles and unsafe addresses never reach the editor. Nothing in the
 * pasted HTML is ever handed to the browser to parse or run.
 */

export interface HtmlElement {
  kind: "element";
  name: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}
export interface HtmlText {
  kind: "text";
  text: string;
}
export type HtmlNode = HtmlElement | HtmlText;

/** How deep elements nest before deeper tags are read as siblings. */
const MAX_DEPTH = 120;

/** Elements dropped with everything inside them. */
const DROPPED = new Set([
  "script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript", "noembed", "noframes",
  "template", "svg", "math", "head", "title", "meta", "link", "base", "canvas", "audio", "video", "source", "track",
  "img", "picture", "map", "area", "input", "select", "textarea", "button", "form", "dialog", "portal", "xmp", "plaintext",
]);
/** Elements whose content is raw text up to their closing tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Block elements that end an open paragraph. */
const CLOSES_P = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "table", "hr", "section",
  "article", "header", "footer", "aside", "nav", "figure", "dl", "dt", "dd", "address", "details", "main",
]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", hellip: "…",
  mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•",
  middot: "·", deg: "°", euro: "€", times: "×", divide: "÷", sect: "§", para: "¶", shy: "­", iexcl: "¡",
  iquest: "¿", cent: "¢", pound: "£", yen: "¥",
};
// Latin-1 letters by name (é, à, ç…), which French text uses all the time.
const LATIN1 =
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
LATIN1.forEach((name, index) => {
  NAMED[name] ??= String.fromCharCode(0xc0 + index);
});
NAMED.OElig = "Œ";
NAMED.oelig = "œ";

/** Text with its character references decoded. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "�";
      return String.fromCodePoint(code);
    }
    return NAMED[ref] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/**
 * Where a tag that starts at `from` ends: its first ">" outside quoted
 * attribute values, or -1. Each tag is read once, so reading stays linear.
 */
function tagEnd(html: string, from: number): number {
  let j = from;
  while (j < html.length) {
    const char = html[j];
    if (char === ">") return j;
    if ((char === '"' || char === "'") && /=\s*$/.test(html.slice(Math.max(from, j - 8), j))) {
      const close = html.indexOf(char, j + 1);
      if (close === -1) return -1;
      j = close + 1;
      continue;
    }
    j += 1;
  }
  return -1;
}

/** The HTML as a tree. Unclosed and stray tags are handled the forgiving way browsers do. */
export function parseHtml(html: string): HtmlElement {
  const root: HtmlElement = { kind: "element", name: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (name: string) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].name === name) {
        stack.length = i;
        return true;
      }
    }
    return false;
  };
  const inScope = (name: string, boundary: string[]) => {
    for (let i = stack.length - 1; i > 0; i--) {
      if (stack[i].name === name) return true;
      if (boundary.includes(stack[i].name)) return false;
    }
    return false;
  };

  let i = 0;
  let text = "";
  const flushText = () => {
    if (text) top().children.push({ kind: "text", text: decodeEntities(text) });
    text = "";
  };
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (!/[a-zA-Z/]/.test(html[i + 1] ?? "")) {
      text += "<";
      i += 1;
      continue;
    }
    const gt = tagEnd(html, i + 1);
    // A tag left open at the end swallows the rest, as in a browser.
    if (gt === -1) break;
    const tag = /^(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s/][\s\S]*)?$/.exec(html.slice(i + 1, gt));
    if (!tag) {
      // Not a tag a browser would read ("<a<b>"): kept as text, read once.
      text += html.slice(i, gt + 1);
      i = gt + 1;
      continue;
    }
    flushText();
    i = gt + 1;
    const name = tag[2].toLowerCase();
    const rest = tag[3] ?? "";
    if (tag[1]) {
      if (name === "p" && !inScope("p", ["div", "li", "td", "th", "blockquote"])) continue;
      closeTo(name);
      continue;
    }
    const attrs = parseAttrs(rest);
    const selfClosing = /\/\s*$/.test(rest);
    if (RAW_TEXT.has(name)) {
      // Skip to the closing tag; the content is never read as markup.
      const close = new RegExp(`</${name}\\s*>`, "ig");
      close.lastIndex = i;
      const found = close.exec(html);
      i = found ? found.index + found[0].length : html.length;
      continue;
    }
    if (CLOSES_P.has(name) && inScope("p", ["div", "li", "td", "th", "blockquote"])) closeTo("p");
    if (name === "li" && inScope("li", ["ul", "ol"])) closeTo("li");
    if ((name === "td" || name === "th") && (inScope("td", ["tr", "table"]) || inScope("th", ["tr", "table"]))) {
      if (!closeTo("td")) closeTo("th");
    }
    if (name === "tr" && inScope("tr", ["table"])) closeTo("tr");
    const element: HtmlElement = { kind: "element", name, attrs, children: [] };
    top().children.push(element);
    // Nesting is capped, so a hostile paste cannot make the readers recurse without end.
    if (!VOID.has(name) && !selfClosing && stack.length < MAX_DEPTH) stack.push(element);
  }
  flushText();
  return root;
}

// ---------------------------------------------------------------------------
// Sanitized HTML, for the editor's own clipboard format.

const SAFE_ATTRS = new Set(["class", "colspan", "rowspan", "colwidth", "alt", "title", "type", "checked", "start", "lang", "dir"]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

/** A file reference the editor stores, or a web address. */
function safeSrc(raw: string): string | null {
  if (/^qbbe-document:[0-9a-f-]{36}$/i.test(raw.trim())) return raw.trim();
  const href = safeHref(raw);
  return href && /^https?:/i.test(href) ? href : null;
}

function serialize(node: HtmlNode): string {
  if (node.kind === "text") return escapeText(node.text);
  const inner = node.children.map(serialize).join("");
  if (node.name === "#root") return inner;
  if (DROPPED.has(node.name) && node.name !== "img" && node.name !== "input" && node.name !== "video" && node.name !== "audio") return "";
  if (!/^[a-z][a-z0-9-]*$/.test(node.name)) return inner;
  const attrs = Object.entries(node.attrs)
    .flatMap(([name, value]) => {
      if (name.startsWith("data-") && /^data-[a-z0-9-]+$/.test(name)) return [[name, value]];
      if (SAFE_ATTRS.has(name)) return [[name, value]];
      if (name === "href") {
        const href = safeHref(value);
        return href ? [[name, href]] : [];
      }
      if (name === "src") {
        const src = safeSrc(value);
        return src ? [[name, src]] : [];
      }
      return [];
    })
    .filter(([name, value]) => !(name === "type" && !/^[a-z]+$/i.test(value)))
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("");
  if (VOID.has(node.name)) return `<${node.name}${attrs}>`;
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/**
 * HTML with only safe tags and attributes left: no scripts, styles, frames,
 * forms or event handlers, and only web, mail and on-site addresses. Used for
 * the editor's own copied blocks, which keep their structure this way.
 */
export function sanitizeHtml(html: string): string {
  return serialize(parseHtml(html));
}

// ---------------------------------------------------------------------------
// Blocks from HTML.

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** The styles an element adds, from its tag and its inline style (Google Docs and Word use both). */
function stylesOf(element: HtmlElement, styles: InlineStyles): InlineStyles {
  const next: InlineStyles = { ...styles };
  const css = (element.attrs.style ?? "").toLowerCase().replace(/\s+/g, "");
  const name = element.name;
  if (name === "strong" || (name === "b" && !/font-weight:(normal|[1-4]00)/.test(css))) next.bold = true;
  if (name === "em" || name === "i" || name === "cite") next.italic = true;
  if (name === "u" || name === "ins") next.underline = true;
  if (name === "s" || name === "strike" || name === "del") next.strike = true;
  if (name === "code" || name === "kbd" || name === "samp" || name === "tt") next.code = true;
  if (/font-weight:(bold|bolder|[6-9]00)/.test(css)) next.bold = true;
  if (/font-weight:(normal|[1-4]00)/.test(css) && name !== "strong") delete next.bold;
  if (/font-style:italic/.test(css)) next.italic = true;
  if (/text-decoration[a-z-]*:[^;]*underline/.test(css)) next.underline = true;
  if (/text-decoration[a-z-]*:[^;]*line-through/.test(css)) next.strike = true;
  return next;
}

class BlockBuilder {
  blocks: EditorBlock[] = [];
  private inline: InlineContent[] = [];

  /** Ends the running paragraph, if it has any text. */
  flush() {
    const content = trimInline(this.inline);
    this.inline = [];
    if (content.length) this.blocks.push({ type: "paragraph", content });
  }

  text(text: string, styles: InlineStyles) {
    pushText(this.inline, text, styles);
  }

  push(block: EditorBlock) {
    this.flush();
    this.blocks.push(block);
  }

  link(href: string | undefined, parts: InlineText[]) {
    pushLink(this.inline, href, parts);
  }
}

function collapse(text: string): string {
  return text.replace(/[ \t\n\r\f]+/g, " ");
}

/** The inline content of an element: its text with styles and links, line breaks kept. */
function inlineOf(nodes: HtmlNode[], styles: InlineStyles = {}, pre = false): InlineContent[] {
  const out: InlineContent[] = [];
  const walk = (list: HtmlNode[], current: InlineStyles) => {
    for (const node of list) {
      if (node.kind === "text") {
        pushText(out, pre ? node.text : collapse(node.text), current);
        continue;
      }
      if (DROPPED.has(node.name)) continue;
      if (node.name === "br") {
        pushText(out, "\n", current);
        continue;
      }
      if (node.name === "a") {
        const parts = inlineOf(node.children, current, pre).filter((part): part is InlineText => part.type === "text");
        pushLink(out, node.attrs.href, parts);
        continue;
      }
      walk(node.children, stylesOf(node, current));
    }
  };
  walk(nodes, styles);
  return pre ? out : trimInline(out);
}

function textOf(node: HtmlNode): string {
  if (node.kind === "text") return node.text;
  if (DROPPED.has(node.name)) return "";
  if (node.name === "br") return "\n";
  return node.children.map(textOf).join("");
}

function listItems(list: HtmlElement, ordered: boolean): EditorBlock[] {
  const items: EditorBlock[] = [];
  const start = Number.parseInt(list.attrs.start ?? "", 10);
  for (const child of list.children) {
    if (child.kind !== "element") continue;
    if (child.name !== "li") {
      if (child.name === "ul" || child.name === "ol") {
        // A list directly inside a list belongs to the item above it.
        const nested = listItems(child, child.name === "ol");
        const parent = items[items.length - 1];
        if (parent) (parent.children ??= []).push(...nested);
        else items.push(...nested);
      }
      continue;
    }
    const checkbox = findCheckbox(child);
    const ownNodes: HtmlNode[] = [];
    const children: EditorBlock[] = [];
    for (const node of child.children) {
      if (node.kind === "element" && (node.name === "ul" || node.name === "ol")) children.push(...listItems(node, node.name === "ol"));
      else ownNodes.push(node);
    }
    const block: EditorBlock = checkbox
      ? { type: "checkListItem", props: { checked: "checked" in checkbox.attrs }, content: inlineOf(ownNodes) }
      : { type: ordered ? "numberedListItem" : "bulletListItem", content: inlineOf(ownNodes) };
    if (ordered && !checkbox && items.length === 0 && Number.isFinite(start) && start > 1) block.props = { start };
    if (children.length) block.children = children;
    items.push(block);
  }
  return items;
}

function findCheckbox(element: HtmlElement): HtmlElement | null {
  for (const child of element.children) {
    if (child.kind !== "element" || child.name === "ul" || child.name === "ol") continue;
    if (child.name === "input" && (child.attrs.type ?? "").toLowerCase() === "checkbox") return child;
    const nested = findCheckbox(child);
    if (nested) return nested;
  }
  return null;
}

function tableRows(table: HtmlElement): HtmlElement[] {
  const rows: HtmlElement[] = [];
  const walk = (node: HtmlElement) => {
    for (const child of node.children) {
      if (child.kind !== "element") continue;
      if (child.name === "tr") rows.push(child);
      else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") walk(child);
    }
  };
  walk(table);
  return rows;
}

function tableFrom(table: HtmlElement): EditorBlock | null {
  const rows = tableRows(table).map((row) =>
    row.children.flatMap((cell) => {
      if (cell.kind !== "element" || (cell.name !== "td" && cell.name !== "th")) return [];
      const content = inlineOf(cell.children);
      // A merged cell keeps its place in each column it spans.
      const span = Math.min(Math.max(Number.parseInt(cell.attrs.colspan ?? "1", 10) || 1, 1), 50);
      return [content, ...Array.from({ length: span - 1 }, () => [] as InlineContent[])];
    }),
  );
  const kept = rows.filter((row) => row.length > 0);
  return kept.length ? tableBlock(kept) : null;
}

function walkBlocks(nodes: HtmlNode[], out: BlockBuilder, styles: InlineStyles) {
  for (const node of nodes) {
    if (node.kind === "text") {
      out.text(collapse(node.text), styles);
      continue;
    }
    const name = node.name;
    if (DROPPED.has(name)) continue;
    if (name in HEADINGS) {
      out.push({ type: "heading", props: { level: HEADINGS[name] }, content: inlineOf(node.children, stylesOf(node, styles)) });
      continue;
    }
    if (name === "ul" || name === "ol") {
      out.flush();
      for (const item of listItems(node, name === "ol")) out.push(item);
      continue;
    }
    if (name === "li") {
      out.push({ type: "bulletListItem", content: inlineOf(node.children, styles) });
      continue;
    }
    if (name === "blockquote") {
      // Each paragraph of a quote becomes its own quote block.
      const inner = new BlockBuilder();
      walkBlocks(node.children, inner, styles);
      inner.flush();
      for (const block of inner.blocks) out.push(block.type === "paragraph" ? { ...block, type: "quote" } : block);
      continue;
    }
    if (name === "pre") {
      const code = node.children.find((child): child is HtmlElement => child.kind === "element" && child.name === "code");
      const language = /(?:^|\s)(?:language|lang)-([\w+#-]+)/.exec(code?.attrs.class ?? node.attrs.class ?? "")?.[1] ?? "";
      const text = textOf(node).replace(/\n$/, "");
      out.push({ type: "codeBlock", props: { language: codeLanguage(language) }, content: text ? [{ type: "text", text, styles: {} }] : [] });
      continue;
    }
    if (name === "hr") {
      out.push({ type: "divider" });
      continue;
    }
    if (name === "table") {
      const table = tableFrom(node);
      if (table) out.push(table);
      continue;
    }
    if (name === "br") {
      out.text("\n", styles);
      continue;
    }
    if (name === "a") {
      out.link(node.attrs.href, inlineOf(node.children, stylesOf(node, styles)).filter((part): part is InlineText => part.type === "text"));
      continue;
    }
    if (CLOSES_P.has(name) || name === "tr" || name === "td" || name === "th") {
      out.flush();
      walkBlocks(node.children, out, stylesOf(node, styles));
      out.flush();
      continue;
    }
    walkBlocks(node.children, out, stylesOf(node, styles));
  }
}

/**
 * Pasted HTML as editor blocks: headings, paragraphs, bold, italic,
 * underline, strike-through, code, links, bullet, numbered and checklist
 * items (nested), quotes, code blocks, dividers and tables. Everything else
 * keeps only its text.
 */
export function htmlToBlocks(html: string): EditorBlock[] {
  const out = new BlockBuilder();
  walkBlocks(parseHtml(html).children, out, {});
  out.flush();
  return out.blocks;
}

/** Whether the HTML carries structure worth keeping over its plain text. */
export function hasRichStructure(html: string): boolean {
  const found = { rich: false };
  const visit = (node: HtmlNode) => {
    if (found.rich || node.kind === "text" || DROPPED.has(node.name)) return;
    const css = (node.attrs.style ?? "").toLowerCase();
    if (/^(h[1-6]|ul|ol|li|blockquote|table|hr|a|strong|em|i|u|s|del|strike|code)$/.test(node.name)) found.rich = true;
    else if (node.name === "b" && !/font-weight:\s*(normal|[1-4]00)/.test(css)) found.rich = true;
    else if (/font-weight:\s*(bold|[6-9]00)|font-style:\s*italic|text-decoration[a-z-]*:[^;]*(underline|line-through)/.test(css)) found.rich = true;
    node.children.forEach(visit);
  };
  visit(parseHtml(html));
  return found.rich;
}
