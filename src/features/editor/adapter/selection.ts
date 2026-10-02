import type { EditorBlock } from "./content";

/**
 * Pure helpers for selecting several blocks and acting on them (U4). They work
 * on the stored block tree and know nothing about the editor library, so the
 * block handle menu, the bulk bar and the Ctrl+/ block menu all agree on what
 * a selection means, and the rules can be tested without a browser.
 *
 * A selection is a list of block ids. Actions apply to the selected blocks
 * that share one list of siblings (the first selected block's); a selected
 * block nested inside another selected block is carried along with its parent.
 */

export type MoveDirection = "up" | "down";

export interface MovePlacement {
  /** The block the selection lands next to. */
  referenceId: string;
  placement: "before" | "after";
}

interface Level {
  siblings: EditorBlock[];
  index: number;
}

/** The sibling lists on the way down to `id`, outermost first. */
function pathTo(blocks: EditorBlock[], id: string, path: Level[] = []): Level[] | null {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const here = [...path, { siblings: blocks, index }];
    if (block.id === id) return here;
    const below = block.children?.length ? pathTo(block.children, id, here) : null;
    if (below) return below;
  }
  return null;
}

/**
 * The ids from `anchorId` to `focusId` inclusive, in document order, at the
 * deepest level where both share a list of siblings. A focus nested inside
 * another block counts as that ancestor; an unknown id selects nothing.
 */
export function selectRange(blocks: EditorBlock[], anchorId: string, focusId: string): string[] {
  const a = pathTo(blocks, anchorId);
  const f = pathTo(blocks, focusId);
  if (!a || !f) return [];
  let depth = 0;
  while (depth + 1 < a.length && depth + 1 < f.length && a[depth + 1].siblings === f[depth + 1].siblings) depth++;
  const { siblings } = a[depth];
  const [from, to] = [a[depth].index, f[depth].index].sort((x, y) => x - y);
  return siblings.slice(from, to + 1).map((block) => block.id!);
}

/**
 * The selected blocks that share the first selected block's list of siblings,
 * in document order (nested selections are covered by their parent).
 */
export function selectedSiblings(blocks: EditorBlock[], ids: string[]): { siblings: EditorBlock[]; chosen: EditorBlock[]; parentId: string | null } {
  const wanted = new Set(ids);
  const first = ids.map((id) => pathTo(blocks, id)).find((path) => path !== null);
  if (!first) return { siblings: blocks, chosen: [], parentId: null };
  const level = first[first.length - 1];
  const parent = first.length > 1 ? first[first.length - 2] : null;
  return {
    siblings: level.siblings,
    chosen: level.siblings.filter((block) => block.id !== undefined && wanted.has(block.id)),
    parentId: parent ? (parent.siblings[parent.index].id ?? null) : null,
  };
}

function replaceSiblings(blocks: EditorBlock[], target: EditorBlock[], next: EditorBlock[]): EditorBlock[] {
  if (blocks === target) return next;
  return blocks.map((block) =>
    block.children?.length ? { ...block, children: replaceSiblings(block.children, target, next) } : block,
  );
}

/**
 * Where the selection lands when moved one step, following the editor's own
 * rule: up goes before the previous sibling, or after its last child when it
 * has children, or before the parent at the top of a nested list; down is
 * the mirror image. Null when the selection is already at that end.
 */
export function movePlacement(blocks: EditorBlock[], ids: string[], direction: MoveDirection): MovePlacement | null {
  const { siblings, chosen, parentId } = selectedSiblings(blocks, ids);
  if (chosen.length === 0) return null;
  if (direction === "up") {
    const prev = siblings[siblings.indexOf(chosen[0]) - 1];
    if (!prev) return parentId ? { referenceId: parentId, placement: "before" } : null;
    const last = prev.children?.length ? prev.children[prev.children.length - 1] : null;
    return last?.id ? { referenceId: last.id, placement: "after" } : { referenceId: prev.id!, placement: "before" };
  }
  const next = siblings[siblings.indexOf(chosen[chosen.length - 1]) + 1];
  if (!next) return parentId ? { referenceId: parentId, placement: "after" } : null;
  const firstChild = next.children?.length ? next.children[0] : null;
  return firstChild?.id ? { referenceId: firstChild.id, placement: "before" } : { referenceId: next.id!, placement: "after" };
}

/** The tree with the selection moved one step, or the same tree when it cannot move. */
export function moveSelection(blocks: EditorBlock[], ids: string[], direction: MoveDirection): EditorBlock[] {
  const target = movePlacement(blocks, ids, direction);
  if (!target) return blocks;
  const { chosen } = selectedSiblings(blocks, ids);
  const without = deleteSelection(blocks, chosen.map((block) => block.id!));
  const destination = pathTo(without, target.referenceId);
  if (!destination) return blocks;
  const level = destination[destination.length - 1];
  const at = target.placement === "before" ? level.index : level.index + 1;
  const next = [...level.siblings.slice(0, at), ...chosen, ...level.siblings.slice(at)];
  return replaceSiblings(without, level.siblings, next);
}

/** A deep copy of a block without ids, so the editor assigns new ones. */
export function cloneBlock(block: EditorBlock): EditorBlock {
  const { id: _id, ...rest } = block;
  void _id;
  const copy: EditorBlock = JSON.parse(JSON.stringify(rest)) as EditorBlock;
  if (block.children?.length) copy.children = block.children.map(cloneBlock);
  return copy;
}

/** The tree with a copy of the selection placed right after it. */
export function duplicateSelection(blocks: EditorBlock[], ids: string[]): EditorBlock[] {
  const { siblings, chosen } = selectedSiblings(blocks, ids);
  if (chosen.length === 0) return blocks;
  const at = siblings.indexOf(chosen[chosen.length - 1]) + 1;
  const next = [...siblings.slice(0, at), ...chosen.map(cloneBlock), ...siblings.slice(at)];
  return replaceSiblings(blocks, siblings, next);
}

/** The tree without the selected blocks (and whatever they contained). */
export function deleteSelection(blocks: EditorBlock[], ids: string[]): EditorBlock[] {
  const wanted = new Set(ids);
  return blocks
    .filter((block) => block.id === undefined || !wanted.has(block.id))
    .map((block) => (block.children?.length ? { ...block, children: deleteSelection(block.children, ids) } : block));
}
