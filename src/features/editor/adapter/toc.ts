import { blockText, walkBlocks, type EditorBlock } from "./content";

/**
 * The table of contents of a document (U5a): the page's headings, levels 1
 * to 3, nested by level. Pure, so the block, the tests and any later server
 * use read the same outline. Headings inside columns and toggles count;
 * headings with no text are left out, since a link with no name reads as
 * nothing.
 */

export type TocLevel = 1 | 2 | 3;

export interface TocEntry {
  /** The heading block's id. */
  id: string;
  level: TocLevel;
  text: string;
  children: TocEntry[];
}

/** The `id` attribute a heading block carries, so `#block-<id>` links reach it. */
export function headingAnchor(blockId: string): string {
  return `block-${blockId}`;
}

function headingLevel(block: EditorBlock): TocLevel | null {
  const raw = block.props?.level ?? 1;
  const level = typeof raw === "number" ? raw : Number(raw);
  return level === 1 || level === 2 || level === 3 ? level : null;
}

export function tocFromBlocks(blocks: EditorBlock[]): TocEntry[] {
  const root: TocEntry[] = [];
  // The open entries, outermost first: a new heading becomes a child of the
  // nearest one with a smaller level.
  const open: TocEntry[] = [];
  for (const { block } of walkBlocks(blocks)) {
    if (block.type !== "heading" || !block.id) continue;
    const level = headingLevel(block);
    if (level === null) continue;
    const text = blockText({ ...block, children: [] }).trim();
    if (!text) continue;
    const entry: TocEntry = { id: block.id, level, text, children: [] };
    while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
    (open.length > 0 ? open[open.length - 1].children : root).push(entry);
    open.push(entry);
  }
  return root;
}
