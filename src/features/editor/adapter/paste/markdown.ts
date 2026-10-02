import type { EditorBlock, InlineContent, InlineText } from "@/features/editor/adapter/content";
import { pushLink, pushText, type InlineStyles } from "./inline";
import { codeFence, isDividerLine, lineShortcut } from "./shortcuts";
import { tableBlock } from "./table";

/**
 * Markdown text as editor blocks. Each line becomes a block, as when the line
 * is typed and followed by Enter, and a line's start follows the same
 * shortcuts as typing (shortcuts.ts). Indented list items nest under the item
 * above. Code fences and pipe tables span several lines.
 */

const PAIRS: { mark: string; style: keyof InlineStyles }[] = [
  { mark: "**", style: "bold" },
  { mark: "__", style: "bold" },
  { mark: "~~", style: "strike" },
  { mark: "*", style: "italic" },
  { mark: "_", style: "italic" },
];

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>~|]/;

/** Inline Markdown (bold, italic, strike, code, links) as inline content. */
export function parseInline(text: string, styles: InlineStyles = {}): InlineContent[] {
  const out: InlineContent[] = [];
  let buffer = "";
  const flush = () => {
    pushText(out, buffer, styles);
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (char === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        pushText(out, text.slice(i + 1, end), { ...styles, code: true });
        i = end + 1;
        continue;
      }
    }
    if (char === "[") {
      const link = readLink(text, i);
      if (link) {
        flush();
        const parts = parseInline(link.label, styles).filter((part): part is InlineText => part.type === "text");
        pushLink(out, link.href, parts);
        i = link.end;
        continue;
      }
    }
    if (char === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(text.slice(i));
      if (auto) {
        flush();
        pushLink(out, auto[1], [{ type: "text", text: auto[1], styles: { ...styles } }]);
        i += auto[0].length;
        continue;
      }
    }
    const pair = PAIRS.find(({ mark }) => text.startsWith(mark, i));
    if (pair && !styles[pair.style]) {
      const end = closingMark(text, i, pair.mark);
      if (end !== -1) {
        flush();
        for (const part of parseInline(text.slice(i + pair.mark.length, end), { ...styles, [pair.style]: true })) {
          if (part.type === "text") pushText(out, (part as InlineText).text, ((part as InlineText).styles ?? {}) as InlineStyles);
          else out.push(part);
        }
        i = end + pair.mark.length;
        continue;
      }
    }
    buffer += char;
    i += 1;
  }
  flush();
  return out;
}

/** Where an emphasis mark opened at `start` closes, or -1 when it does not. */
function closingMark(text: string, start: number, mark: string): number {
  const open = start + mark.length;
  if (open >= text.length || /\s/.test(text[open])) return -1;
  // "_" inside a word (snake_case) is not emphasis.
  if (mark[0] === "_" && start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) return -1;
  let search = open + 1;
  while (search <= text.length) {
    const end = text.indexOf(mark, search);
    if (end === -1) return -1;
    const before = text[end - 1];
    const after = text[end + mark.length];
    const single = mark.length === 1 && (text[end + 1] === mark || text[end - 1] === mark);
    if (!/\s/.test(before) && !single && !(mark[0] === "_" && after && /[\p{L}\p{N}]/u.test(after))) return end;
    search = end + 1;
  }
  return -1;
}

function readLink(text: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        if (text[i + 1] !== "(") return null;
        const close = text.indexOf(")", i + 2);
        if (close === -1) return null;
        const target = text.slice(i + 2, close).trim().split(/\s+/)[0] ?? "";
        return { label: text.slice(start + 1, i), href: target.replace(/^<|>$/g, ""), end: close + 1 };
      }
    }
  }
  return null;
}

const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      cell += "|";
      i += 1;
    } else if (trimmed[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += trimmed[i];
  }
  cells.push(cell.trim());
  return cells;
}

function indentOf(line: string): number {
  const match = /^[ \t]*/.exec(line)![0];
  return match.replace(/\t/g, "    ").length;
}

const NESTABLE = new Set(["bulletListItem", "numberedListItem", "checkListItem"]);

/** Markdown text as editor blocks. */
export function markdownToBlocks(markdown: string): EditorBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: EditorBlock[] = [];
  // The list items a deeper-indented line can nest under.
  let stack: { indent: number; block: EditorBlock }[] = [];
  const place = (block: EditorBlock, indent: number) => {
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent && NESTABLE.has(block.type)) (parent.block.children ??= []).push(block);
    else {
      stack = [];
      blocks.push(block);
    }
    if (NESTABLE.has(block.type)) stack.push({ indent, block });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = indentOf(line);
    const body = line.trim();

    const fence = codeFence(body);
    if (fence) {
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "```") {
        code.push(lines[j]);
        j += 1;
      }
      place({ type: "codeBlock", props: { language: fence.language }, content: code.length ? [{ type: "text", text: code.join("\n"), styles: {} }] : [] }, indent);
      i = j;
      continue;
    }
    if (isDividerLine(body)) {
      place({ type: "divider" }, indent);
      continue;
    }
    if (body.startsWith("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const rows = [tableCells(body)];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        rows.push(tableCells(lines[j]));
        j += 1;
      }
      place(tableBlock(rows.map((row) => row.map((cell) => parseInline(cell)))), indent);
      i = j - 1;
      continue;
    }
    const shortcut = lineShortcut(body);
    if (shortcut) {
      const block: EditorBlock = { type: shortcut.block.type, content: parseInline(shortcut.rest.trim()) };
      if (shortcut.block.props) block.props = { ...shortcut.block.props };
      place(block, indent);
      continue;
    }
    place({ type: "paragraph", content: parseInline(body) }, indent);
  }
  return blocks;
}

/**
 * Whether plain text reads as Markdown: a line starts with a shortcut, a code
 * fence or a pipe table, or the text holds bold, italic, code or a link.
 */
export function looksLikeMarkdown(text: string): boolean {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.some((line) => lineShortcut(line.trim()) || codeFence(line) || isDividerLine(line))) return true;
  if (lines.some((line, index) => line.trim().startsWith("|") && TABLE_RULE.test(lines[index + 1] ?? ""))) return true;
  return /\*\*[^*\s][^*]*\*\*|__[^_\s][^_]*__|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~\s][^~]*~~/.test(text);
}
