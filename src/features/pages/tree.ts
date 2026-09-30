/**
 * Pure helpers for the page tree (M4a): building it from flat rows, ordering
 * siblings, and working out where a page may move. No I/O, so every rule the
 * sidebar and the server actions share is unit-tested here.
 */

export type PageVisibility = "workspace" | "private";

export interface PageRow {
  id: string;
  parentPageId: string | null;
  visibility: PageVisibility;
  title: string;
  icon: string | null;
  cover: string | null;
  position: number;
  createdBy: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PageNode extends PageRow {
  children: PageNode[];
  depth: number;
}

function bySiblingOrder(a: PageRow, b: PageRow): number {
  return a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * The rows that are live: not trashed, and not inside a trashed page (trashing
 * a page takes everything inside it along).
 */
export function liveRows<T extends Pick<PageRow, "id" | "parentPageId" | "deletedAt">>(rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const memo = new Map<string, boolean>();
  const isLive = (row: T, seen: Set<string>): boolean => {
    const known = memo.get(row.id);
    if (known !== undefined) return known;
    let live = !row.deletedAt;
    if (live && row.parentPageId && !seen.has(row.parentPageId)) {
      const parent = byId.get(row.parentPageId);
      if (parent) live = isLive(parent, new Set(seen).add(row.id));
    }
    memo.set(row.id, live);
    return live;
  };
  return rows.filter((row) => isLive(row, new Set()));
}

/**
 * Nests flat rows under their parents, siblings in order, leaving out trashed
 * pages and what they hold. A row whose parent is not visible to the reader
 * is shown at the top level rather than dropped, so nothing they may see
 * disappears.
 */
export function buildTree(rows: PageRow[]): PageNode[] {
  const nodes = new Map<string, PageNode>();
  for (const row of liveRows(rows)) nodes.set(row.id, { ...row, children: [], depth: 0 });
  const roots: PageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentPageId ? nodes.get(node.parentPageId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const settle = (list: PageNode[], depth: number) => {
    list.sort(bySiblingOrder);
    for (const node of list) {
      node.depth = depth;
      settle(node.children, depth + 1);
    }
  };
  settle(roots, 0);
  return roots;
}

/** Depth-first order, the order a screen reader walks the tree. */
export function flatten(nodes: PageNode[], isExpanded: (id: string) => boolean = () => true): PageNode[] {
  const out: PageNode[] = [];
  const walk = (list: PageNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && isExpanded(node.id)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** The ids of a page and everything inside it. */
export function subtreeIds(rows: Pick<PageRow, "id" | "parentPageId">[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentPageId) continue;
    children.set(row.parentPageId, [...(children.get(row.parentPageId) ?? []), row.id]);
  }
  const ids = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!ids.has(child)) {
        ids.add(child);
        stack.push(child);
      }
    }
  }
  return ids;
}

/** Whether moving `pageId` under `newParentId` would put it inside itself. */
export function isMoveIntoOwnSubtree(
  rows: Pick<PageRow, "id" | "parentPageId">[],
  pageId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  return subtreeIds(rows, pageId).has(newParentId);
}

/** Ancestors from the top level down to the page's parent, for breadcrumbs. */
export function ancestors<T extends Pick<PageRow, "id" | "parentPageId">>(rows: T[], pageId: string): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const chain: T[] = [];
  const seen = new Set<string>([pageId]);
  let parentId = byId.get(pageId)?.parentPageId ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentPageId;
  }
  return chain;
}

/**
 * A position strictly between two neighbours (fractional ordering), so a move
 * rewrites one row. `null` means "no neighbour on that side".
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return (after as number) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

/** The position that puts a page last among the given siblings. */
export function positionAtEnd(siblings: Pick<PageRow, "position">[]): number {
  if (siblings.length === 0) return positionBetween(null, null);
  return positionBetween(Math.max(...siblings.map((s) => s.position)), null);
}

/**
 * The new position when moving a page one step up or down among its siblings,
 * or null when it is already at that end.
 */
export function positionForStep(
  siblings: Pick<PageRow, "id" | "position" | "title">[],
  pageId: string,
  direction: "up" | "down",
): number | null {
  const ordered = [...siblings].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((s) => s.id === pageId);
  if (index < 0) return null;
  if (direction === "up") {
    if (index === 0) return null;
    const before = index >= 2 ? ordered[index - 2].position : null;
    return positionBetween(before, ordered[index - 1].position);
  }
  if (index === ordered.length - 1) return null;
  const after = index + 2 < ordered.length ? ordered[index + 2].position : null;
  return positionBetween(ordered[index + 1].position, after);
}
