import {
  CONTENT_VERSION,
  blockText,
  type EditorBlock,
  type EditorContent,
  type InlineContent,
  type InlineLink,
  type InlineText,
  type TableContent,
} from "@/features/editor/adapter/content";
import { matchEntity } from "./entities";
import { mergeRuns, plain, safeHref, text, trimEndSpaceTab, trimSpaceTab, type Styles } from "./inline";

/**
 * Pages as Markdown and back (wave 2 unit X1). Pure, so the export route, the
 * import route and the unit tests share one implementation.
 *
 * Export writes CommonMark with the GitHub extensions people expect (tables,
 * task lists, ~~strikethrough~~, `> [!NOTE]` callouts). Import reads the same
 * and the common variants other tools write. Text blocks round-trip:
 * headings, paragraphs, bulleted, numbered and check lists (nested), quotes,
 * callouts, code with its language, tables and dividers, with bold, italic,
 * strikethrough, inline code and links. Raw HTML inside Markdown is never
 * kept: tags are dropped, and script-like elements with their content.
 */

/** Nesting deeper than this is read as plain lines, so a hostile file cannot exhaust the stack. */
export const MAX_NESTING = 16;

const CALLOUT_TAGS: Record<string, string> = { info: "NOTE", success: "TIP", warning: "WARNING", danger: "CAUTION" };
const CALLOUT_TONES: Record<string, string> = { NOTE: "info", TIP: "success", IMPORTANT: "info", WARNING: "warning", CAUTION: "danger" };

// ---------------------------------------------------------------------------
// Export

export interface MarkdownExportOptions {
  /** Written first as a level 1 heading; the importer reads it back as the title. */
  title?: string;
  /** The line a view block exports as (a link to its CSV file); null leaves it out. */
  viewLine?: (block: EditorBlock) => string | null;
}

/** Characters that mean something inside a line, escaped wherever they appear in text. */
function escapeInline(value: string): string {
  return value.replace(/[\\`*_~[\]<|]/g, "\\$&").replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
}

/** A line that would start a block if it were read on its own. */
function escapeLineStart(full: string): string {
  // Leading spaces are not kept by a reader, so the test is on what follows them.
  const line = full.trimStart();
  if (line === "") return line;
  if (/^#{1,6}(\s|$)/.test(line) || /^[-+]/.test(line) || /^>/.test(line) || /^=+\s*$/.test(line)) return `\\${line}`;
  const numbered = /^(\d+)([.)])(\s|$)/.exec(line);
  if (numbered) return `${numbered[1]}\\${line.slice(numbered[1].length)}`;
  return line;
}

/** A trailing run of "#" would be read as a heading's closing marks. */
function headingText(markdown: string): string {
  return markdown.replace(/(^|\s)(#+)$/, "$1\\$2");
}

function stylesOf(run: InlineText): Styles {
  const s = run.styles ?? {};
  return {
    ...(s.bold === true ? { bold: true as const } : {}),
    ...(s.italic === true ? { italic: true as const } : {}),
    ...(s.strike === true ? { strike: true as const } : {}),
    ...(s.code === true ? { code: true as const } : {}),
  };
}

function codeSpan(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = value.startsWith("`") || value.endsWith("`") || (/^ .* $/.test(value) && value.trim() !== "") ? " " : "";
  return `${fence}${pad}${value}${pad}${fence}`;
}

type Token =
  | { kind: "text"; text: string; styles: Styles }
  | { kind: "break" }
  | { kind: "raw"; markdown: string };

const EMPHASIS = [
  ["bold", "**"],
  ["italic", "*"],
  ["strike", "~~"],
] as const;

/** Markers wrap the text, never the spaces at its edges (`** a**` is not bold). */
function wrap(inner: string, marker: string): string {
  const lead = /^\s*/.exec(inner)![0];
  if (lead.length === inner.length) return inner;
  const trail = inner.slice(inner.trimEnd().length);
  return `${lead}${marker}${inner.slice(lead.length, inner.length - trail.length)}${marker}${trail}`;
}

/**
 * Appends, keeping a closing marker from running into the next opening one
 * (`**a**` then `*b*` would read as `**a***b*`): an empty comment between
 * them is invisible to every Markdown reader.
 */
function append(out: string, next: string): string {
  const last = out[out.length - 1];
  return (last === "*" || last === "~") && next[0] === last ? `${out}<!-- -->${next}` : out + next;
}

/** Styled runs as nested emphasis: a style shared by neighbouring runs opens once around all of them. */
function emphasis(tokens: Extract<Token, { kind: "text" }>[], active: ReadonlySet<string>): string {
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const next = EMPHASIS.find(([style]) => token.styles[style] && !active.has(style));
    if (!next) {
      out = append(out, token.styles.code ? codeSpan(token.text) : escapeInline(token.text));
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && tokens[j].styles[next[0]]) j++;
    out = append(out, wrap(emphasis(tokens.slice(i, j), new Set([...active, next[0]])), next[1]));
    i = j;
  }
  return out;
}

function render(tokens: Token[], inCell: boolean): string {
  // Line breaks at the very end have no Markdown form; leave them out.
  while (tokens.length && tokens[tokens.length - 1].kind === "break") tokens.pop();
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "break") {
      out += inCell ? "<br>" : "\\\n";
      i++;
    } else if (token.kind === "raw") {
      out = append(out, token.markdown);
      i++;
    } else {
      let j = i;
      while (j < tokens.length && tokens[j].kind === "text") j++;
      out = append(out, emphasis(tokens.slice(i, j) as Extract<Token, { kind: "text" }>[], new Set()));
      i = j;
    }
  }
  return out;
}

function tokens(runs: InlineText[]): Token[] {
  return runs.flatMap((run) =>
    run.text.split("\n").flatMap((part, index): Token[] => [
      ...(index > 0 ? [{ kind: "break" as const }] : []),
      ...(part ? [{ kind: "text" as const, text: part, styles: stylesOf(run) }] : []),
    ]),
  );
}

function linkTarget(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href;
}

export function inlineToMarkdown(content: EditorBlock["content"], inCell = false): string {
  if (!Array.isArray(content)) return typeof content === "string" ? escapeInline(content) : "";
  const all: Token[] = content.flatMap((item): Token[] => {
    if (item.type === "text") return tokens([item as InlineText]);
    if (item.type === "link") {
      const link = item as InlineLink;
      const label = render(tokens(link.content), inCell);
      const href = safeHref(link.href);
      return [{ kind: "raw", markdown: href ? `[${label}](${linkTarget(href)})` : label }];
    }
    const value = (item as { text?: unknown }).text;
    return typeof value === "string" ? tokens([{ type: "text", text: value }]) : [];
  });
  return render(all, inCell);
}

interface Chunk {
  text: string;
  /** List items sit next to each other without a blank line. */
  list: boolean;
}

function join(chunks: Chunk[]): string {
  let out = "";
  chunks.forEach((chunk, i) => {
    if (i > 0) out += chunk.list && chunks[i - 1].list ? "\n" : "\n\n";
    out += chunk.text;
  });
  return out;
}

function indent(textBlock: string, width: number): string {
  const pad = " ".repeat(width);
  return textBlock
    .split("\n")
    .map((line) => (line === "" ? "" : pad + line))
    .join("\n");
}

function lines(markdown: string): string {
  return markdown.split("\n").map(escapeLineStart).join("\n");
}

function cellContent(cell: unknown): EditorBlock["content"] {
  if (Array.isArray(cell)) return cell as InlineContent[];
  if (cell && typeof cell === "object" && Array.isArray((cell as { content?: unknown }).content)) {
    return (cell as { content: InlineContent[] }).content;
  }
  return typeof cell === "string" ? cell : [];
}

function tableToMarkdown(table: TableContent): string | null {
  const rows = table.rows.map((row) => row.cells.map((cell) => inlineToMarkdown(cellContent(cell), true).replace(/\n/g, " ")));
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (rows.length === 0 || width === 0) return null;
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
}

function mediaLine(block: EditorBlock): string | null {
  const props = block.props ?? {};
  const url = typeof props.url === "string" ? safeHref(props.url) : null;
  const label = [props.caption, props.name, props.title].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (url) return `[${escapeInline(label ?? url)}](${linkTarget(url)})`;
  return label ? escapeInline(label) : null;
}

function quoteLines(body: string): string {
  return body
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

function renderBlocks(blocks: EditorBlock[], options: MarkdownExportOptions): Chunk[] {
  const chunks: Chunk[] = [];
  let number = 0;
  for (const block of blocks) {
    number = block.type === "numberedListItem" ? number + 1 : 0;
    chunks.push(...renderBlock(block, options, number));
  }
  return chunks;
}

function renderBlock(block: EditorBlock, options: MarkdownExportOptions, number: number): Chunk[] {
  const children = block.children ?? [];
  const own = () => lines(inlineToMarkdown(block.content));
  const after = () => renderBlocks(children, options);

  switch (block.type) {
    case "paragraph": {
      const body = own();
      return [...(body.trim() ? [{ text: body, list: false }] : []), ...after()];
    }
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(block.props?.level) || 1));
      const body = headingText(inlineToMarkdown(block.content).replace(/\\\n/g, " ").trimStart());
      return [{ text: `${"#".repeat(level)} ${body}`.trimEnd(), list: false }, ...after()];
    }
    case "bulletListItem":
    case "toggleListItem":
    case "numberedListItem":
    case "checkListItem": {
      const marker =
        block.type === "numberedListItem"
          ? `${number}.`
          : block.type === "checkListItem"
            ? `- [${block.props?.checked === true ? "x" : " "}]`
            : "-";
      // Children line up under the item's text (after "- ", "1. ").
      const width = block.type === "checkListItem" ? 2 : marker.length + 1;
      const body = own();
      const [first, ...more] = body.split("\n");
      let item = `${marker}${body ? ` ${first}` : ""}${more.length ? `\n${indent(more.join("\n"), width)}` : ""}`;
      const nested = renderBlocks(children, options);
      if (nested.length) item += `${nested[0].list ? "\n" : "\n\n"}${indent(join(nested), width)}`;
      return [{ text: item, list: true }];
    }
    case "quote":
    case "callout": {
      const body = own();
      const tag = block.type === "callout" ? `[!${CALLOUT_TAGS[String(block.props?.tone)] ?? "NOTE"}]` : null;
      const nested = join(renderBlocks(children, options));
      const inner = [tag, body || null].filter(Boolean).join("\n");
      const whole = nested ? `${inner}${inner ? "\n\n" : ""}${nested}` : inner;
      return whole ? [{ text: quoteLines(whole), list: false }] : [];
    }
    case "codeBlock": {
      const code = Array.isArray(block.content) ? plain(block.content) : typeof block.content === "string" ? block.content : "";
      const longest = Math.max(0, ...(code.match(/`{3,}/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const language = typeof block.props?.language === "string" ? block.props.language.replace(/[^A-Za-z0-9_+#.-]/g, "") : "";
      return [{ text: `${fence}${language}\n${code}${code ? "\n" : ""}${fence}`, list: false }];
    }
    case "table": {
      const table = block.content && !Array.isArray(block.content) && typeof block.content === "object" ? tableToMarkdown(block.content as TableContent) : null;
      return table ? [{ text: table, list: false }] : [];
    }
    case "divider":
      return [{ text: "---", list: false }];
    case "image":
    case "video":
    case "audio":
    case "file":
    case "bookmark":
    case "embed": {
      const line = mediaLine(block);
      return line ? [{ text: lines(line), list: false }] : [];
    }
    case "query": {
      const line = options.viewLine?.(block) ?? null;
      return line ? [{ text: lines(line), list: false }] : [];
    }
    case "columnList":
    case "column":
      return after();
    default: {
      // Blocks with no Markdown form keep their readable text.
      const value = blockText({ ...block, children: [] });
      return [...(value.trim() ? [{ text: lines(escapeInline(value).replace(/\n/g, "\\\n")), list: false }] : []), ...after()];
    }
  }
}

/** The page as one Markdown file, title first. */
export function contentToMarkdown(content: EditorContent, options: MarkdownExportOptions = {}): string {
  const chunks = renderBlocks(content.blocks, options);
  if (options.title !== undefined && options.title.trim() !== "") {
    chunks.unshift({ text: `# ${headingText(escapeInline(options.title.trim()))}`, list: false });
  }
  return `${join(chunks)}\n`;
}

// ---------------------------------------------------------------------------
// Import: blocks

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
/** Tested on a line already trimmed of spaces and tabs, so no two space runs meet (linear time). */
const SEPARATOR = /^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?$/;
const TASK = /^\[([ xX])\](?:[ \t]+(.*))?$/;

const blank = (line: string) => line.trim() === "";
const leading = (line: string) => /^ */.exec(line)![0].length;

function isFence(line: string): boolean {
  const match = FENCE.exec(line);
  return Boolean(match) && !(match![2][0] === "`" && match![3].includes("`"));
}

/** A heading's optional closing hashes (`## Title ##`), removed by a scan rather than a backtracking pattern. */
function withoutClosingHashes(body: string): string {
  const end = trimEndSpaceTab(body).length;
  let hashes = end;
  while (hashes > 0 && body[hashes - 1] === "#") hashes--;
  if (hashes === end) return body;
  let space = hashes;
  while (space > 0 && (body[space - 1] === " " || body[space - 1] === "\t")) space--;
  return space === hashes ? body : body.slice(0, space);
}

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && SEPARATOR.test(trimSpaceTab(lines[i + 1]));
}

function isBlockStart(lines: string[], i: number): boolean {
  const line = lines[i];
  return blank(line) || isFence(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) || isTableStart(lines, i);
}

/** Paragraph lines as one string: a trailing backslash or two spaces is a line break, any other line end a space. */
function joinLines(source: string[]): string {
  let out = "";
  source.forEach((raw, i) => {
    let line = i === 0 ? raw.replace(/^[ \t]+/, "") : raw.trim();
    if (i === source.length - 1) {
      out += trimEndSpaceTab(line);
      return;
    }
    let slashes = 0;
    while (slashes < line.length && line[line.length - 1 - slashes] === "\\") slashes++;
    let breakHere = false;
    if (slashes % 2 === 1) {
      line = line.slice(0, -1);
      breakHere = true;
    } else if (raw.endsWith("  ")) {
      breakHere = true;
    }
    out += trimEndSpaceTab(line) + (breakHere ? "\n" : " ");
  });
  return out;
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = "";
  let code = 0;
  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === "\\" && i + 1 < row.length) {
      // An escaped pipe is a pipe in the cell; other escapes stay for the inline reader.
      current += row[i + 1] === "|" ? "\\|" : char + row[i + 1];
      i++;
      continue;
    }
    if (char === "`") code = code ? 0 : 1;
    if (char === "|" && !code) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function paragraph(content: InlineContent[]): EditorBlock {
  return { type: "paragraph", content };
}

function expandTabs(line: string): string {
  if (!line.includes("\t")) return line;
  let out = "";
  for (const char of line) {
    if (char === "\t") out += " ".repeat(4 - (out.length % 4));
    else out += char;
  }
  return out;
}

/** Lines of Markdown as editor blocks. */
export function parseBlocks(source: string[], depth = 0): EditorBlock[] {
  const lines = source.map(expandTabs);
  const out: EditorBlock[] = [];
  if (depth > MAX_NESTING) {
    for (const line of lines) if (!blank(line)) out.push(paragraph(parseInline(line.trim())));
    return out;
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (blank(line)) {
      i++;
      continue;
    }

    const fence = isFence(line) ? FENCE.exec(line) : null;
    if (fence) {
      const pad = fence[1].length;
      const marker = fence[2];
      const close = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
      const code: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        code.push(lines[i].slice(Math.min(pad, leading(lines[i]))));
        i++;
      }
      i++;
      const language = fence[3].trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9_+#.-]/g, "") ?? "";
      const value = code.join("\n");
      out.push({ type: "codeBlock", props: language ? { language } : {}, content: value ? [text(value)] : [] });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      let body = heading[2].trim();
      body = /^#+$/.test(body) ? "" : withoutClosingHashes(body);
      out.push({ type: "heading", props: { level: heading[1].length }, content: parseInline(body) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: "divider" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i++;
      }
      const tag = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(inner[0] ?? "");
      const blocks = parseBlocks(tag ? inner.slice(1) : inner, depth + 1);
      const first = blocks[0]?.type === "paragraph" ? blocks.shift()! : null;
      out.push({
        type: tag ? "callout" : "quote",
        ...(tag ? { props: { tone: CALLOUT_TONES[tag[1].toUpperCase()] } } : {}),
        content: (first?.content as InlineContent[] | undefined) ?? [],
        ...(blocks.length ? { children: blocks } : {}),
      });
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows = [splitRow(line)];
      i += 2;
      while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const width = rows[0].length;
      const table: TableContent = {
        type: "tableContent",
        headerRows: 1,
        rows: rows.map((cells) => ({
          cells: Array.from({ length: width }, (_, c) => ({ type: "tableCell", content: parseInline(cells[c] ?? "") })),
        })),
      };
      out.push({ type: "table", content: table });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const [, pad, marker, spaces = "", rest = ""] = item;
      const gap = rest === "" ? 1 : spaces.length > 4 ? 1 : spaces.length;
      const column = pad.length + marker.length + gap;
      const body: string[] = [spaces.length > 4 ? " ".repeat(spaces.length - 1) + rest : rest];
      let sawBlank = false;
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (blank(next)) {
          body.push("");
          sawBlank = true;
          i++;
          continue;
        }
        if (leading(next) >= column) {
          body.push(next.slice(column));
          i++;
          continue;
        }
        // A plain line right after the item's text continues it.
        if (!sawBlank && !isBlockStart(lines, i)) {
          body.push(next.trim());
          i++;
          continue;
        }
        break;
      }
      while (body.length > 1 && blank(body[body.length - 1])) body.pop();

      const numbered = /^\d/.test(marker);
      const task = numbered ? null : TASK.exec(body[0]);
      if (task) body[0] = task[2] ?? "";
      const blocks = body[0].trim() === "" && body.length > 1 ? [paragraph([]), ...parseBlocks(body.slice(1), depth + 1)] : parseBlocks(body, depth + 1);
      const first = blocks[0]?.type === "paragraph" ? blocks.shift()! : null;
      out.push({
        type: task ? "checkListItem" : numbered ? "numberedListItem" : "bulletListItem",
        ...(task ? { props: { checked: task[1] !== " " } } : {}),
        content: (first?.content as InlineContent[] | undefined) ?? [],
        ...(blocks.length ? { children: blocks } : {}),
      });
      continue;
    }

    const para: string[] = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines, i)) {
      para.push(lines[i]);
      i++;
    }
    const content = parseInline(joinLines(para));
    if (content.length) out.push(paragraph(content));
  }
  return out;
}

/** A Markdown file as editor content, with its leading level 1 heading as the title when it has one. */
export function markdownToContent(source: string): { title: string | null; content: EditorContent } {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = parseBlocks(normalized.split("\n"));
  let title: string | null = null;
  const first = blocks[0];
  if (first?.type === "heading" && first.props?.level === 1 && !first.children) {
    title = plain(first.content as InlineContent[]).replace(/\s+/g, " ").trim() || null;
    blocks.shift();
  }
  return { title, content: { version: CONTENT_VERSION, blocks } };
}

// ---------------------------------------------------------------------------
// Import: inline

/** Elements whose content is dropped with them, never shown as text. */
const DROPPED_WITH_CONTENT = /^(script|style|iframe|object|embed|noscript|template|textarea|title|svg|math|frame|frameset|applet)$/i;
const PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const MAX_INLINE_DEPTH = 8;
/** A link target longer than this is not read as one. */
const MAX_TARGET = 2048;

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function runLength(source: string, at: number, char: string): number {
  let n = 0;
  while (source[at + n] === char) n++;
  return n;
}

/**
 * One paragraph's text and what is already known about it. Searches that
 * failed are remembered, so text built to make the reader search again and
 * again (a long line of `*` or `[`) is read in linear time.
 */
class Scanner {
  /** For each search (by key), a position from which it is known to fail. */
  private failed = new Map<string, number>();
  private brackets: Map<number, number> | null = null;
  private parens: Map<number, number> | null = null;
  private nextIndex = new Map<string, Int32Array>();

  constructor(readonly source: string) {}

  /** The code span starting at `at`, or null when its backticks are never closed. */
  codeSpan(at: number): { end: number; inner: string } | null {
    const { source } = this;
    const ticks = runLength(source, at, "`");
    const key = `\`${ticks}`;
    if ((this.failed.get(key) ?? Infinity) <= at) return null;
    let j = at + ticks;
    while (j < source.length) {
      const next = source.indexOf("`", j);
      if (next < 0) break;
      const len = runLength(source, next, "`");
      if (len === ticks) {
        let inner = source.slice(at + ticks, next);
        if (inner.length > 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim() !== "") inner = inner.slice(1, -1);
        return { end: next + len, inner };
      }
      j = next + len;
    }
    this.failed.set(key, at);
    return null;
  }

  /**
   * Where an emphasis run that opened at `from` with `size` copies of `char`
   * closes, or -1. Inner runs of the other size are skipped as a whole when
   * they close themselves, so `*a **b** c*` and `***x***` nest as written.
   */
  close(from: number, char: string, size: number, depth = 0): number {
    const { source } = this;
    const key = `${char}${size}`;
    if ((this.failed.get(key) ?? Infinity) <= from) return -1;
    let j = from;
    while (j < source.length) {
      const c = source[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") {
        const span = this.codeSpan(j);
        j = span ? span.end : j + runLength(source, j, "`");
        continue;
      }
      if (c !== char) {
        j++;
        continue;
      }
      const run = runLength(source, j, char);
      const closes = j > from && !isSpace(source[j - 1]) && (char !== "_" || !isWordChar(source[j + run]));
      if (closes && run === size) return j;
      if (closes && run > size) return size === 1 ? j : j + run - size;
      // A run of the other size opening here: skip past its own close.
      if (!isSpace(source[j + run]) && depth < MAX_INLINE_DEPTH) {
        const other = run >= 2 ? 2 : 1;
        if (other !== size) {
          const inner = this.close(j + other, char, other, depth + 1);
          if (inner > 0) {
            j = inner + other;
            continue;
          }
        }
      }
      j += run;
    }
    this.failed.set(key, from);
    return -1;
  }

  /** The "]" matching each "[", found in one pass. */
  private matchBrackets(): Map<number, number> {
    const { source } = this;
    const pairs = new Map<number, number>();
    const open: number[] = [];
    for (let j = 0; j < source.length; j++) {
      const c = source[j];
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "`") {
        const span = this.codeSpan(j);
        j = (span ? span.end : j + runLength(source, j, "`")) - 1;
        continue;
      }
      if (c === "[") open.push(j);
      else if (c === "]" && open.length) pairs.set(open.pop()!, j);
    }
    return pairs;
  }

  /** `[label](target)` starting at `at` (on the "["), or null. */
  link(at: number): { label: string; href: string; end: number } | null {
    const { source } = this;
    this.brackets ??= this.matchBrackets();
    const j = this.brackets.get(at);
    if (j === undefined || source[j + 1] !== "(") return null;
    const label = source.slice(at + 1, j);
    const open = j + 1;
    let k = open + 1;
    for (let spaces = 0; source[k] === " " && spaces < 32; spaces++) k++;
    let href: string;
    if (source[k] === "<") {
      const close = this.next(">", k);
      if (close < 0 || close - k > MAX_TARGET) return null;
      href = source.slice(k + 1, close);
      k = close + 1;
    } else {
      // With no title, the target runs to the ")" matching the opening "(".
      this.parens ??= this.matchParens();
      const close = this.parens.get(open);
      if (close !== undefined && close >= k && close - k <= MAX_TARGET) {
        return { label, href: unescape(source.slice(k, close).trimEnd()), end: close + 1 };
      }
      const space = this.next(" ", k);
      const stop = space < 0 ? source.length : space;
      if (stop - k > MAX_TARGET) return null;
      href = unescape(source.slice(k, stop));
      k = stop;
    }
    // An optional "title" after the target is read and ignored.
    const title = /^\s*(?:"[^"]{0,500}"|'[^']{0,500}')?\s*\)/.exec(source.slice(k, k + 600));
    if (!title) return null;
    return { label, href, end: k + title[0].length };
  }

  /**
   * The ")" matching each "(", found in one pass. A space ends every open
   * "(" (a link target has none), except spaces just after a "(", which a
   * link may have before its target.
   */
  private matchParens(): Map<number, number> {
    const { source } = this;
    const pairs = new Map<number, number>();
    let open: number[] = [];
    let afterOpen = false;
    for (let j = 0; j < source.length; j++) {
      const c = source[j];
      const space = /\s/.test(c);
      if (c === "\\") j++;
      else if (c === "(") open.push(j);
      else if (c === ")" && open.length) pairs.set(open.pop()!, j);
      else if (space && !afterOpen) open = [];
      afterOpen = c === "(" || (afterOpen && space);
    }
    return pairs;
  }

  /** The next index of `char` (" " meaning any whitespace) at or after `from`, from a table built once. */
  next(char: ">" | " ", from: number): number {
    let table = this.nextIndex.get(char);
    if (!table) {
      const { source } = this;
      table = new Int32Array(source.length + 1);
      table[source.length] = -1;
      for (let j = source.length - 1; j >= 0; j--) {
        table[j] = (char === " " ? /\s/.test(source[j]) : source[j] === char) ? j : table[j + 1];
      }
      this.nextIndex.set(char, table);
    }
    return from >= this.source.length ? -1 : table[from];
  }
}

function unescape(value: string): string {
  return value.replace(/\\([!-/:-@[-`{-~])/g, "$1");
}

function withStyle(styles: Styles, key: keyof Styles): Styles {
  return { ...styles, [key]: true };
}

/** Markdown inline text as editor inline content. Links never nest; tags are dropped. */
export function parseInline(source: string, styles: Styles = {}, inLink = false, depth = 0): InlineContent[] {
  const scan = new Scanner(source);
  const out: InlineContent[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(text(buffer, styles));
    buffer = "";
  };
  const nested = (inner: string, next: Styles) => {
    flush();
    out.push(...parseInline(inner, next, inLink, depth + 1));
  };

  let i = 0;
  while (i < source.length) {
    const c = source[i];

    if (c === "\\") {
      const next = source[i + 1];
      if (next !== undefined && PUNCTUATION.test(next)) {
        buffer += next;
        i += 2;
        continue;
      }
      buffer += c;
      i++;
      continue;
    }

    if (c === "&") {
      const entity = matchEntity(source.slice(i, i + 40));
      if (entity) {
        buffer += entity.text;
        i += entity.length;
        continue;
      }
    }

    if (c === "`") {
      const span = scan.codeSpan(i);
      if (span) {
        flush();
        out.push(text(span.inner.replace(/\n/g, " "), withStyle(styles, "code")));
        i = span.end;
        continue;
      }
      const ticks = runLength(source, i, "`");
      buffer += source.slice(i, i + ticks);
      i += ticks;
      continue;
    }

    if (c === "<") {
      const rest = source.slice(i, i + MAX_TARGET);
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest);
      if (auto) {
        const href = safeHref(auto[1]);
        flush();
        if (href && !inLink) out.push({ type: "link", href, content: [text(auto[1], styles)] });
        else out.push(text(auto[1], styles));
        i += auto[0].length;
        continue;
      }
      const lineBreak = /^<br\s*\/?>/i.exec(rest);
      if (lineBreak) {
        buffer += "\n";
        i += lineBreak[0].length;
        continue;
      }
      if (rest.startsWith("<!--")) {
        const end = source.indexOf("-->", i + 4);
        i = end < 0 ? source.length : end + 3;
        continue;
      }
      const tag = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*)?\/?>/.exec(rest);
      if (tag) {
        i += tag[0].length;
        if (!tag[1] && DROPPED_WITH_CONTENT.test(tag[2])) {
          const closer = new RegExp(`</${tag[2]}`, "ig");
          closer.lastIndex = i;
          const found = closer.exec(source);
          const end = found ? source.indexOf(">", found.index) : -1;
          i = end < 0 ? source.length : end + 1;
        }
        continue;
      }
    }

    if ((c === "[" || (c === "!" && source[i + 1] === "[")) && depth < MAX_INLINE_DEPTH) {
      const image = c === "!";
      const link = scan.link(image ? i + 1 : i);
      if (link) {
        const href = safeHref(link.href);
        const label = parseInline(link.label, styles, true, depth + 1);
        flush();
        if (href && !inLink) {
          const runs = mergeRuns(label).flatMap((item) => (item.type === "text" ? [item as InlineText] : []));
          out.push({ type: "link", href, content: runs.length ? runs : [text(href, styles)] });
        } else {
          out.push(...label);
        }
        i = link.end;
        continue;
      }
    }

    if ((c === "*" || c === "_" || c === "~") && depth < MAX_INLINE_DEPTH) {
      const run = runLength(source, i, c);
      const opens = !isSpace(source[i + run]) && (c !== "_" || !isWordChar(source[i - 1]));
      if (c === "~" && run === 2 && opens) {
        const close = scan.close(i + 2, "~", 2);
        if (close > 0) {
          nested(source.slice(i + 2, close), withStyle(styles, "strike"));
          i = close + 2;
          continue;
        }
      } else if (c !== "~" && opens) {
        const size = run >= 2 ? 2 : 1;
        const close = scan.close(i + size, c, size);
        if (close > 0) {
          nested(source.slice(i + size, close), withStyle(styles, size === 2 ? "bold" : "italic"));
          i = close + size;
          continue;
        }
        if (size === 2) {
          // "**" with no partner may still open a single emphasis.
          const single = scan.close(i + 1, c, 1);
          if (single > 0) {
            nested(source.slice(i + 1, single), withStyle(styles, "italic"));
            i = single + 1;
            continue;
          }
        }
      }
      buffer += source.slice(i, i + run);
      i += run;
      continue;
    }

    buffer += c;
    i++;
  }
  flush();
  return depth === 0 ? mergeRuns(out) : out;
}
