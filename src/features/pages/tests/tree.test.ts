import { describe, expect, it } from "vitest";
import {
  ancestors,
  buildTree,
  flatten,
  isMoveIntoOwnSubtree,
  liveRows,
  positionAtEnd,
  positionBetween,
  positionForStep,
  subtreeIds,
  type PageRow,
} from "@/features/pages/tree";

function page(id: string, parentPageId: string | null, position: number, extra: Partial<PageRow> = {}): PageRow {
  return {
    id,
    parentPageId,
    visibility: "workspace",
    title: id,
    icon: null,
    cover: null,
    position,
    createdBy: "me",
    updatedAt: "2026-09-30T00:00:00Z",
    deletedAt: null,
    ...extra,
  };
}

const rows = [
  page("b", null, 2),
  page("a", null, 1),
  page("a2", "a", 2),
  page("a1", "a", 1),
  page("a1x", "a1", 1),
];

describe("buildTree", () => {
  it("nests children under parents in sibling order, with depth", () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(["a", "b"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(tree[0].children[0].children[0]).toMatchObject({ id: "a1x", depth: 2 });
  });

  it("shows a page whose parent is not visible at the top level", () => {
    const tree = buildTree([page("orphan", "hidden", 1)]);
    expect(tree.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("leaves out a trashed page and everything inside it", () => {
    const tree = buildTree(rows.map((r) => (r.id === "a1" ? { ...r, deletedAt: "2026-09-30T00:00:00Z" } : r)));
    expect(flatten(tree).map((n) => n.id)).toEqual(["a", "a2", "b"]);
  });

  it("does not loop on a cycle in bad data", () => {
    const live = liveRows([page("x", "y", 1), page("y", "x", 1)]);
    expect(live.map((r) => r.id).sort()).toEqual(["x", "y"]);
  });
});

describe("flatten", () => {
  it("walks depth first and skips collapsed branches", () => {
    const tree = buildTree(rows);
    expect(flatten(tree).map((n) => n.id)).toEqual(["a", "a1", "a1x", "a2", "b"]);
    expect(flatten(tree, (id) => id !== "a1").map((n) => n.id)).toEqual(["a", "a1", "a2", "b"]);
  });
});

describe("moving", () => {
  it("knows a page's subtree", () => {
    expect([...subtreeIds(rows, "a")].sort()).toEqual(["a", "a1", "a1x", "a2"]);
  });

  it("refuses a move into the page itself or its descendants", () => {
    expect(isMoveIntoOwnSubtree(rows, "a", "a1x")).toBe(true);
    expect(isMoveIntoOwnSubtree(rows, "a", "a")).toBe(true);
    expect(isMoveIntoOwnSubtree(rows, "a1", "b")).toBe(false);
    expect(isMoveIntoOwnSubtree(rows, "a1", null)).toBe(false);
  });

  it("lists ancestors from the top down", () => {
    expect(ancestors(rows, "a1x").map((r) => r.id)).toEqual(["a", "a1"]);
    expect(ancestors(rows, "a")).toEqual([]);
  });
});

describe("positions", () => {
  it("finds a position between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(null, 10)).toBeLessThan(10);
    expect(positionBetween(10, null)).toBeGreaterThan(10);
  });

  it("puts a new page last", () => {
    expect(positionAtEnd([])).toBe(1024);
    expect(positionAtEnd([{ position: 5 }, { position: 9 }])).toBeGreaterThan(9);
  });

  it("steps a page up and down among its siblings", () => {
    const siblings = [page("p1", null, 1), page("p2", null, 2), page("p3", null, 3)];
    const up = positionForStep(siblings, "p3", "up")!;
    expect(up).toBeGreaterThan(1);
    expect(up).toBeLessThan(2);
    const down = positionForStep(siblings, "p1", "down")!;
    expect(down).toBeGreaterThan(2);
    expect(down).toBeLessThan(3);
    expect(positionForStep(siblings, "p1", "up")).toBeNull();
    expect(positionForStep(siblings, "p3", "down")).toBeNull();
    expect(positionForStep(siblings, "missing", "up")).toBeNull();
  });
});
