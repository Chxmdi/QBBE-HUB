import {
  CONTENT_VERSION,
  type EditorBlock,
  type EditorContent,
  type InlineContent,
  type InlineText,
  type TableContent,
} from "@/features/editor/adapter/content";
import { decodeEntities } from "./entities";
import { mergeRuns, plain, safeHref, text, trimRuns, type Styles } from "./inline";
import { MAX_NESTING } from "./markdown";

/**
 * An HTML file as editor blocks (wave 2 unit X1). Runs on the server, so it
 * reads the file with its own small tokenizer instead of a browser DOM, and
 * it keeps by allowlist: only the elements below become blocks or styles,
 * and only `href` (web and mail addresses), `checked`, `type` and the code
 * language class are ever read. Scripts, styles, frames, objects, forms and
 * their content are dropped; event handlers and `javascript:` links never
 * reach the page because no other attribute is read at all.
 */

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "param"]);
/** Dropped with everything inside them. */
const DROPPED = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "title", "svg", "math",
  "frame", "frameset", "applet", "head", "select", "button", "form", "canvas", "audio", "video", "dialog",
]);
/** Elements whose content is read as raw text until their own end tag. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "noscript", "iframe", "noembed", "noframes"]);
/** An open one of these is closed by the next of the same kind (or a sibling kind). */
const AUTO_CLOSE: Record<string, string[]> = {
  p: ["p"],
  li: ["li"],
  dt: ["dt", "dd"],
  dd: ["dt", "dd"],
  tr: ["tr"],
  td: ["td", "th"],
  th: ["td", "th"],
  option: ["option"],
};
const BLOCK_STARTS_CLOSE_P = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul", "figure", "details",
]);

const FOREIGN = new Set(["svg", "math"]);
/** Open elements kept at once; a deeper file is read flatter, never slower. */
const MAX_OPEN = 256;

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** HTML as a tree of elements and text, tolerant of the mistakes real files have. */
export function parseHtml(source: string): Element {
  const root: Element = { tag: "#root", attrs: {}, children: [] };
  const stack: Element[] = [root];
  const top = () => stack[stack.length - 1];
  const closeTo = (tag: string) => {
    for (let k = stack.length - 1; k > 0; k--) {
      if (stack[k].tag === tag) {
        stack.length = k;
        return;
      }
    }
  };

  let i = 0;
  const length = source.length;
  while (i < length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      top().children.push(decodeEntities(source.slice(i)));
      break;
    }
    if (lt > i) top().children.push(decodeEntities(source.slice(i, lt)));
    i = lt;

    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      i = end < 0 ? length : end + 3;
      continue;
    }
    if (source[i + 1] === "!" || source[i + 1] === "?") {
      const end = source.indexOf(">", i);
      i = end < 0 ? length : end + 1;
      continue;
    }
    const tag = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/.exec(source.slice(i, i + 64));
    if (!tag) {
      top().children.push("<");
      i++;
      continue;
    }
    // The tag ends at the first ">" outside quotes.
    let j = i + tag[0].length;
    let quote: string | null = null;
    for (; j < length; j++) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    const inside = source.slice(i + tag[0].length, j);
    i = j + 1;
    const name = tag[2].toLowerCase();

    if (tag[1]) {
      closeTo(name);
      continue;
    }

    if (RAW_TEXT.has(name)) {
      const closer = new RegExp(`</${name}\\s*>`, "ig");
      closer.lastIndex = i;
      const found = closer.exec(source);
      const content = found ? source.slice(i, found.index) : source.slice(i);
      i = found ? found.index + found[0].length : length;
      if (!DROPPED.has(name)) top().children.push(decodeEntities(content));
      continue;
    }

    const siblings = AUTO_CLOSE[name];
    if (siblings) {
      // Close an open sibling, but not across a list or table boundary.
      for (let k = stack.length - 1; k > 0; k--) {
        const open = stack[k].tag;
        if (siblings.includes(open)) {
          stack.length = k;
          break;
        }
        if (["ul", "ol", "table", "tbody", "thead", "tfoot", "dl"].includes(open)) break;
        if (name === "p" && !["span", "a", "b", "strong", "i", "em", "u", "s", "del", "code", "font"].includes(open)) break;
      }
    }
    if (BLOCK_STARTS_CLOSE_P.has(name)) {
      const k = stack.length - 1;
      if (k > 0 && stack[k].tag === "p") stack.length = k;
    }

    const element: Element = { tag: name, attrs: parseAttributes(inside), children: [] };
    top().children.push(element);
    // A "/" before ">" closes foreign elements (svg, math). Browsers ignore it on HTML elements, so
    // `<a href=https://example.org/>` stays open; but an element dropped with its content is taken
    // as closed, so `<form/>` cannot hide the rest of the file. Past MAX_OPEN, new elements still
    // hold their text, but in their parent.
    const tail = inside.trimEnd();
    const selfClosing = DROPPED.has(name) ? tail.endsWith("/") : FOREIGN.has(name) && /(^|\s|["'])\/$/.test(tail);
    if (!VOID.has(name) && !selfClosing && stack.length < MAX_OPEN) stack.push(element);
  }
  return root;
}

// ---------------------------------------------------------------------------
// Tree to blocks

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const INLINE_STYLE: Record<string, keyof Styles> = {
  b: "bold",
  strong: "bold",
  i: "italic",
  em: "italic",
  cite: "italic",
  s: "strike",
  del: "strike",
  strike: "strike",
  code: "code",
  kbd: "code",
  samp: "code",
  tt: "code",
};
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "aside", "nav", "body", "html", "figure", "figcaption",
  "blockquote", "pre", "ul", "ol", "li", "table", "hr", "dl", "dt", "dd", "address", "details", "summary", "center",
  ...Object.keys(HEADINGS),
]);

function isElement(node: Node): node is Element {
  return typeof node !== "string";
}

function isBlockElement(node: Node): boolean {
  return isElement(node) && (BLOCK_TAGS.has(node.tag) || DROPPED.has(node.tag));
}

function textContent(node: Node): string {
  if (!isElement(node)) return node;
  if (DROPPED.has(node.tag)) return "";
  if (node.tag === "br") return "\n";
  return node.children.map(textContent).join("");
}

/** Inline content of mixed nodes: whitespace collapses as a browser would, <br> is a line break. */
function inline(nodes: Node[], styles: Styles = {}, inLink = false, depth = 0): InlineContent[] {
  const out: InlineContent[] = [];
  for (const node of nodes) {
    if (!isElement(node)) {
      const collapsed = node.replace(/[ \t\r\n\f]+/g, " ");
      if (collapsed) out.push(text(collapsed, styles));
      continue;
    }
    if (DROPPED.has(node.tag)) continue;
    if (node.tag === "br") {
      out.push(text("\n", styles));
      continue;
    }
    if (node.tag === "img") {
      const alt = (node.attrs.alt ?? "").trim();
      const src = safeHref(node.attrs.src ?? "");
      if (src && !inLink) out.push({ type: "link", href: src, content: [text(alt || src, styles)] });
      else if (alt) out.push(text(alt, styles));
      continue;
    }
    if (node.tag === "input") continue;
    if (depth > MAX_NESTING * 2) {
      out.push(text(textContent(node).replace(/\s+/g, " "), styles));
      continue;
    }
    if (node.tag === "a") {
      const href = safeHref(node.attrs.href ?? "");
      const content = inline(node.children, styles, true, depth + 1);
      if (href && !inLink) {
        const runs = mergeRuns(content).flatMap((item) => (item.type === "text" ? [item as InlineText] : []));
        if (runs.some((run) => run.text.trim())) out.push({ type: "link", href, content: runs });
      } else {
        out.push(...content);
      }
      continue;
    }
    const style = INLINE_STYLE[node.tag];
    out.push(...inline(node.children, style ? { ...styles, [style]: true } : styles, inLink, depth + 1));
  }
  return out;
}

/** Inline content with the edges trimmed and the spaces around line breaks removed. */
function lineContent(nodes: Node[]): InlineContent[] {
  const runs = trimRuns(inline(nodes)).map((item) =>
    item.type === "text" ? { ...(item as InlineText), text: (item as InlineText).text.replace(/ ?\n ?/g, "\n") } : item,
  );
  return mergeRuns(runs);
}

function hasText(content: InlineContent[]): boolean {
  return plain(content).trim() !== "";
}

function codeLanguage(pre: Element): string {
  const code = pre.children.find((child): child is Element => isElement(child) && child.tag === "code");
  const classes = `${code?.attrs.class ?? ""} ${pre.attrs.class ?? ""}`;
  const match = /(?:^|\s)(?:language|lang)-([A-Za-z0-9_+#.-]+)/.exec(classes);
  return match ? match[1] : (code?.attrs["data-language"] ?? pre.attrs["data-language"] ?? "").replace(/[^A-Za-z0-9_+#.-]/g, "");
}

function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (node: Element) => {
    for (const child of node.children) {
      if (!isElement(child)) continue;
      if (child.tag === "tr") rows.push(child);
      else if (["thead", "tbody", "tfoot"].includes(child.tag)) visit(child);
    }
  };
  visit(table);
  return rows;
}

function tableBlock(table: Element): EditorBlock | null {
  const rows = rowsOf(table).map((row) =>
    row.children.filter((cell): cell is Element => isElement(cell) && (cell.tag === "td" || cell.tag === "th")),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || width === 0) return null;
  const header = rows[0].length > 0 && rows[0].every((cell) => cell.tag === "th");
  const content: TableContent = {
    type: "tableContent",
    ...(header ? { headerRows: 1 } : {}),
    rows: rows.map((cells) => ({
      cells: Array.from({ length: width }, (_, c) => ({ type: "tableCell", content: cells[c] ? lineContent(cells[c].children) : [] })),
    })),
  };
  return { type: "table", content };
}

/** A list item: its own text, a checkbox when it starts with one, and nested lists as children. */
function listItem(li: Element, ordered: boolean, depth: number): EditorBlock {
  const own: Node[] = [];
  const rest: Node[] = [];
  let checkbox: Element | null = null;
  /** Whether the item's own text so far shows anything (kept as it grows, so a long item is read once). */
  let ownHasText = false;
  const addOwn = (node: Node) => {
    own.push(node);
    if (!ownHasText) ownHasText = textContent(node).trim() !== "";
  };
  for (const child of li.children) {
    if (rest.length === 0 && !isBlockElement(child)) {
      if (isElement(child) && child.tag === "input" && (child.attrs.type ?? "").toLowerCase() === "checkbox" && !checkbox && !ownHasText) {
        checkbox = child;
        continue;
      }
      addOwn(child);
    } else if (rest.length === 0 && isElement(child) && child.tag === "p" && !ownHasText) {
      // <li><p>text</p></li> is the item's own text.
      child.children.forEach(addOwn);
      rest.push("");
    } else {
      rest.push(child);
    }
  }
  const children = blocks(rest, depth + 1);
  return {
    type: checkbox ? "checkListItem" : ordered ? "numberedListItem" : "bulletListItem",
    ...(checkbox ? { props: { checked: "checked" in checkbox.attrs } } : {}),
    content: lineContent(own),
    ...(children.length ? { children } : {}),
  };
}

/** Block-level nodes as editor blocks; loose inline runs between them become paragraphs. */
function blocks(nodes: Node[], depth = 0): EditorBlock[] {
  const out: EditorBlock[] = [];
  let pending: Node[] = [];
  const flushParagraph = () => {
    const content = lineContent(pending);
    pending = [];
    if (hasText(content)) out.push({ type: "paragraph", content });
  };

  for (const node of nodes) {
    if (!isBlockElement(node)) {
      pending.push(node);
      continue;
    }
    flushParagraph();
    const element = node as Element;
    if (DROPPED.has(element.tag)) continue;
    if (depth > MAX_NESTING) {
      const value = textContent(element).replace(/\s+/g, " ").trim();
      if (value) out.push({ type: "paragraph", content: [text(value)] });
      continue;
    }
    const level = HEADINGS[element.tag];
    if (level) {
      const content = lineContent(element.children).map((item) =>
        item.type === "text" ? { ...(item as InlineText), text: (item as InlineText).text.replace(/\n/g, " ") } : item,
      );
      out.push({ type: "heading", props: { level }, content });
      continue;
    }
    switch (element.tag) {
      case "p":
      case "dt":
      case "dd":
      case "figcaption":
      case "summary":
      case "address": {
        const inner = element.children.some(isBlockElement) ? blocks(element.children, depth + 1) : null;
        if (inner) out.push(...inner);
        else {
          const content = lineContent(element.children);
          if (hasText(content)) out.push({ type: "paragraph", content });
        }
        break;
      }
      case "hr":
        out.push({ type: "divider" });
        break;
      case "pre": {
        const code = textContent(element).replace(/^\n/, "").replace(/\n$/, "");
        const language = codeLanguage(element);
        out.push({ type: "codeBlock", props: language ? { language } : {}, content: code ? [text(code)] : [] });
        break;
      }
      case "blockquote": {
        const inner = blocks(element.children, depth + 1);
        const first = inner[0]?.type === "paragraph" ? inner.shift()! : null;
        out.push({
          type: "quote",
          content: (first?.content as InlineContent[] | undefined) ?? [],
          ...(inner.length ? { children: inner } : {}),
        });
        break;
      }
      case "ul":
      case "ol":
        for (const child of element.children) {
          if (isElement(child) && child.tag === "li") out.push(listItem(child, element.tag === "ol", depth));
          else if (isElement(child) && (child.tag === "ul" || child.tag === "ol")) out.push(...blocks([child], depth + 1));
          else if (!isElement(child) && child.trim()) out.push({ type: "paragraph", content: [text(child.trim())] });
        }
        break;
      case "li":
        out.push(listItem(element, false, depth));
        break;
      case "table": {
        const table = tableBlock(element);
        if (table) out.push(table);
        break;
      }
      default:
        // Containers (div, section, body…) hold blocks of their own.
        out.push(...blocks(element.children, depth + 1));
    }
  }
  flushParagraph();
  return out;
}

/** An HTML file as editor content, with its first level 1 heading (or <title>) as the title. */
/**
 * The text of the first `<title>` whose closing tag follows within 500
 * characters, found in linear time: each opening tag's end is looked up once,
 * so a file of many unclosed `<title` tags cannot make the search quadratic.
 */
function titleElementText(source: string): string | null {
  const opening = /<title(?=[\s/>])/gi;
  let tagEnd = -1;
  for (let match = opening.exec(source); match; match = opening.exec(source)) {
    const after = match.index + match[0].length;
    if (tagEnd < after) tagEnd = source.indexOf(">", after);
    if (tagEnd < 0) return null;
    const window = source.slice(tagEnd + 1, tagEnd + 1 + 500 + 64);
    const closing = /<\/title\s*>/i.exec(window);
    if (closing && closing.index <= 500) return window.slice(0, closing.index);
  }
  return null;
}

export function htmlToContent(source: string): { title: string | null; content: EditorContent } {
  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const tree = parseHtml(normalized);
  const result = blocks(tree.children);
  let title: string | null = null;
  const first = result[0];
  if (first?.type === "heading" && first.props?.level === 1) {
    title = plain(first.content as InlineContent[]).replace(/\s+/g, " ").trim() || null;
    if (title) result.shift();
  }
  if (!title) {
    const titleText = titleElementText(normalized);
    const value = titleText !== null ? decodeEntities(titleText).replace(/\s+/g, " ").trim() : "";
    title = value || null;
  }
  return { title, content: { version: CONTENT_VERSION, blocks: result } };
}
