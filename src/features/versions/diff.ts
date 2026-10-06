import type { BlockSnapshot, ContentSnapshot, PropertySnapshot } from "./content";

/**
 * Comparing two versions (M16b). Blocks are matched by id, so a moved or
 * edited block lines up with itself; text inside a changed block is compared
 * word by word.
 */

export type TextPart = { kind: "same" | "added" | "removed"; text: string };

export type BlockChange =
  | { kind: "same"; id: string; before: BlockSnapshot; after: BlockSnapshot }
  | { kind: "changed"; id: string; before: BlockSnapshot; after: BlockSnapshot; parts: TextPart[] }
  | { kind: "added"; id: string; after: BlockSnapshot }
  | { kind: "removed"; id: string; before: BlockSnapshot };

export interface PropertyChange {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

export interface SnapshotDiff {
  blocks: BlockChange[];
  properties: PropertyChange[];
  changedCount: number;
}

/** Words and the spaces between them, so joining the parts rebuilds the text. */
function tokens(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Word-level diff by longest common subsequence; long texts fall back to whole-block. */
export function diffText(before: string, after: string): TextPart[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > 250_000) {
    return [
      ...(before ? [{ kind: "removed" as const, text: before }] : []),
      ...(after ? [{ kind: "added" as const, text: after }] : []),
    ];
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const parts: TextPart[] = [];
  const push = (kind: TextPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("removed", a[i++]);
    } else {
      push("added", b[j++]);
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return parts;
}

function sameBlock(a: BlockSnapshot, b: BlockSnapshot): boolean {
  return a.type === b.type && a.text === b.text && JSON.stringify(a.props ?? {}) === JSON.stringify(b.props ?? {});
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** `before` is the older side, `after` the newer; blocks follow the newer order. */
export function diffSnapshots(
  before: { content: ContentSnapshot; properties: PropertySnapshot },
  after: { content: ContentSnapshot; properties: PropertySnapshot },
): SnapshotDiff {
  const older = new Map(before.content.blocks.map((block) => [block.id, block]));
  const newerIds = new Set(after.content.blocks.map((block) => block.id));
  const blocks: BlockChange[] = [];

  // Removed blocks are shown where they used to be: after the block that preceded them.
  const removedAfter = new Map<string | null, BlockSnapshot[]>();
  let previous: string | null = null;
  for (const block of before.content.blocks) {
    if (!newerIds.has(block.id)) {
      const list = removedAfter.get(previous) ?? [];
      list.push(block);
      removedAfter.set(previous, list);
    } else {
      previous = block.id;
    }
  }
  const flushRemoved = (key: string | null) => {
    for (const block of removedAfter.get(key) ?? []) blocks.push({ kind: "removed", id: block.id, before: block });
  };

  flushRemoved(null);
  for (const block of after.content.blocks) {
    const old = older.get(block.id);
    if (!old) blocks.push({ kind: "added", id: block.id, after: block });
    else if (sameBlock(old, block)) blocks.push({ kind: "same", id: block.id, before: old, after: block });
    else blocks.push({ kind: "changed", id: block.id, before: old, after: block, parts: diffText(old.text, block.text) });
    flushRemoved(block.id);
  }

  const keys = [...new Set([...Object.keys(after.properties), ...Object.keys(before.properties)])];
  const properties = keys.map((key) => ({
    key,
    before: before.properties[key] ?? null,
    after: after.properties[key] ?? null,
    changed: !sameValue(before.properties[key], after.properties[key]),
  }));

  return {
    blocks,
    properties,
    changedCount:
      blocks.filter((block) => block.kind !== "same").length + properties.filter((p) => p.changed).length,
  };
}

/**
 * The current content with one block put back as it was in a version: replaced
 * in place if it still exists, otherwise re-inserted after the block that
 * preceded it in the version (or first).
 */
export function restoreBlockInto(current: ContentSnapshot, version: ContentSnapshot, blockId: string): ContentSnapshot {
  const index = version.blocks.findIndex((block) => block.id === blockId);
  if (index < 0) throw new Error("block_not_in_version");
  const restored = version.blocks[index];
  const blocks = [...current.blocks];
  const existing = blocks.findIndex((block) => block.id === blockId);
  if (existing >= 0) {
    blocks[existing] = restored;
  } else {
    let insertAt = 0;
    for (let i = index - 1; i >= 0; i--) {
      const at = blocks.findIndex((block) => block.id === version.blocks[i].id);
      if (at >= 0) {
        insertAt = at + 1;
        break;
      }
    }
    blocks.splice(insertAt, 0, restored);
  }
  return { ...current, blocks };
}
