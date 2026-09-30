/**
 * The stored shape of an editor document, independent of the editor library.
 *
 * Blocks follow a tree of `{ id, type, props, content, children }`, which is
 * BlockNote's JSON and close to any ProseMirror-based editor's. Nothing outside
 * `adapter/` may depend on BlockNote itself, so a fallback (plain Tiptap) can
 * replace it by converting to and from this shape.
 */

export const CONTENT_VERSION = 1;

export interface InlineText {
  type: "text";
  text: string;
  styles?: Record<string, boolean | string>;
}

export interface InlineLink {
  type: "link";
  href: string;
  content: InlineText[];
}

export type InlineContent = InlineText | InlineLink | { type: string; [key: string]: unknown };

export interface TableContent {
  type: "tableContent";
  rows: { cells: unknown[] }[];
  [key: string]: unknown;
}

export interface EditorBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: InlineContent[] | TableContent | string;
  children?: EditorBlock[];
}

export interface EditorContent {
  version: typeof CONTENT_VERSION;
  blocks: EditorBlock[];
}

export function emptyContent(): EditorContent {
  return { version: CONTENT_VERSION, blocks: [] };
}

/** Accepts anything read from storage; returns valid content or empty content. */
export function normalizeContent(value: unknown): EditorContent {
  if (!value || typeof value !== "object") return emptyContent();
  const blocks = (value as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return emptyContent();
  return {
    version: CONTENT_VERSION,
    blocks: blocks.filter(
      (block): block is EditorBlock =>
        Boolean(block) && typeof block === "object" && typeof (block as EditorBlock).type === "string",
    ),
  };
}

/**
 * Plain text as editor content: one paragraph per line, blank lines kept as
 * empty paragraphs so the text reads the same. Used to convert old plain-text
 * fields (task descriptions, M4d) on read and in the migration.
 */
export function plainTextToContent(text: string | null | undefined): EditorContent {
  const source = (text ?? "").replace(/\r\n?/g, "\n");
  if (source.trim() === "") return emptyContent();
  const lines = source.replace(/\n+$/, "").split("\n");
  return {
    version: CONTENT_VERSION,
    blocks: lines.map((line) => ({
      type: "paragraph",
      content: line === "" ? [] : [{ type: "text", text: line }],
    })),
  };
}

function inlineText(content: EditorBlock["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  if (!Array.isArray(content)) {
    return content.rows
      .map((row) => row.cells.map((cell) => inlineText(cellContent(cell))).join("\t"))
      .join("\n");
  }
  return content
    .map((item) => {
      if (item.type === "text") return (item as InlineText).text;
      if (item.type === "link") return (item as InlineLink).content.map((part) => part.text).join("");
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function cellContent(cell: unknown): EditorBlock["content"] {
  if (Array.isArray(cell)) return cell as InlineContent[];
  if (cell && typeof cell === "object" && Array.isArray((cell as { content?: unknown }).content)) {
    return (cell as { content: InlineContent[] }).content;
  }
  return "";
}

/** The text of one block and its descendants, for search and previews. */
export function blockText(block: EditorBlock): string {
  const own = inlineText(block.content);
  const extra = typeof block.props?.url === "string" && !own ? String(block.props.url) : "";
  const children = (block.children ?? []).map(blockText).filter(Boolean);
  return [own || extra, ...children].filter(Boolean).join("\n");
}

/** The whole document as plain text, one block per line. */
export function contentToPlainText(content: EditorContent): string {
  return content.blocks.map(blockText).join("\n").replace(/\n+$/, "");
}

/** Every block in document order, depth first, with its depth. */
export function walkBlocks(blocks: EditorBlock[], depth = 0): { block: EditorBlock; depth: number }[] {
  return blocks.flatMap((block) => [{ block, depth }, ...walkBlocks(block.children ?? [], depth + 1)]);
}
