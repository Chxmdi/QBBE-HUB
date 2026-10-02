import type { EditorBlock } from "./content";

/**
 * Column structure rules (U5a). A `columnList`'s children are `column`
 * blocks, at least two of them, and a `column` lives only in a column list.
 * Block moves and outdenting are generic editor commands that know nothing of
 * these rules, so after a local change the editor asks for the fixes below
 * and applies them. Pure, so the rules are tested without an editor.
 */

export type ColumnFix =
  /** Give the column list these children (loose blocks gathered into columns). */
  | { kind: "rewrap"; id: string; children: EditorBlock[] }
  /** Replace the block with these blocks (none removes it). */
  | { kind: "unwrap"; id: string; blocks: EditorBlock[] };

const emptyParagraph = (): EditorBlock => ({ type: "paragraph" });

function fixColumnList(list: EditorBlock & { id: string }): ColumnFix | null {
  const columns: EditorBlock[] = [];
  const leading: EditorBlock[] = [];
  let changed = false;
  for (const child of list.children ?? []) {
    if (child.type === "column") {
      if ((child.children ?? []).length === 0) {
        columns.push({ ...child, children: [emptyParagraph()] });
        changed = true;
      } else {
        columns.push({ ...child });
      }
      continue;
    }
    // A loose block joins the column before it, or the first column.
    changed = true;
    const last = columns[columns.length - 1];
    if (last) last.children = [...(last.children ?? []), child];
    else leading.push(child);
  }
  if (leading.length > 0) {
    if (columns.length > 0) columns[0] = { ...columns[0], children: [...leading, ...(columns[0].children ?? [])] };
    else columns.push({ type: "column", props: { width: 1 }, children: leading });
  }
  if (columns.length === 0) return { kind: "unwrap", id: list.id, blocks: [] };
  if (columns.length === 1) return { kind: "unwrap", id: list.id, blocks: columns[0].children ?? [] };
  return changed ? { kind: "rewrap", id: list.id, children: columns } : null;
}

/**
 * The fixes the document needs, outermost first. A subtree that needs a fix
 * is not searched further: the next pass, after the fix, looks inside it.
 */
export function columnFixes(blocks: EditorBlock[], parentType: string | null = null): ColumnFix[] {
  const fixes: ColumnFix[] = [];
  for (const block of blocks) {
    if (!block.id) continue;
    if (block.type === "column" && parentType !== "columnList") {
      fixes.push({ kind: "unwrap", id: block.id, blocks: block.children ?? [] });
      continue;
    }
    if (block.type === "columnList") {
      const fix = fixColumnList(block as EditorBlock & { id: string });
      if (fix) {
        fixes.push(fix);
        continue;
      }
    }
    fixes.push(...columnFixes(block.children ?? [], block.type));
  }
  return fixes;
}
