import { describe, expect, it } from "vitest";
import {
  clampDepth,
  distancesFrom,
  filterGraph,
  layoutGraph,
  outlineGraph,
  type GraphData,
  type GraphEdge,
  type GraphNode,
} from "./graph";

const node = (id: string, type: string, title = id): GraphNode => ({ ref: { id, type }, title, href: null });
const edge = (from: GraphNode, key: GraphEdge["relationTypeKey"], to: GraphNode): GraphEdge => ({
  relationTypeKey: key,
  from: from.ref,
  to: to.ref,
  source: "object_relation",
});

// programme P contains project A; A contains milestone M; M contains tasks T1, T2;
// T1 blocks T2; project B is on its own.
const P = node("p", "program", "Programme");
const A = node("a", "project", "Alpha");
const B = node("b", "project", "Beta");
const M = node("m", "milestone", "Launch");
const T1 = node("t1", "task", "Book venue");
const T2 = node("t2", "task", "Send invites");
const data: GraphData = {
  nodes: [P, A, B, M, T1, T2],
  edges: [edge(P, "contains", A), edge(A, "contains", M), edge(M, "contains", T1), edge(M, "contains", T2), edge(T1, "blocks", T2)],
};

describe("clampDepth", () => {
  it("keeps depth between 1 and 3 and defaults to 2", () => {
    expect(clampDepth("0")).toBe(1);
    expect(clampDepth("9")).toBe(3);
    expect(clampDepth("x")).toBe(2);
    expect(clampDepth(2)).toBe(2);
  });
});

describe("distancesFrom", () => {
  it("walks relations in both directions up to the depth", () => {
    const d = distancesFrom(data, "m", 1);
    expect(Object.fromEntries(d)).toEqual({ m: 0, a: 1, t1: 1, t2: 1 });
    expect(distancesFrom(data, "m", 2).get("p")).toBe(2);
  });
  it("returns nothing for an unknown root", () => {
    expect(distancesFrom(data, "zzz", 3).size).toBe(0);
  });
});

describe("filterGraph", () => {
  it("keeps only the requested types and drops edges to hidden objects", () => {
    const shown = filterGraph(data, { types: ["task"], rootId: null, depth: 2 });
    expect(shown.nodes.map((n) => n.ref.id)).toEqual(["t1", "t2"]);
    expect(shown.edges).toHaveLength(1);
    expect(shown.edges[0].relationTypeKey).toBe("blocks");
  });
  it("limits to the depth around a root, and never walks through a hidden type", () => {
    const shown = filterGraph(data, { types: [], rootId: "a", depth: 1 });
    expect(shown.nodes.map((n) => n.ref.id).sort()).toEqual(["a", "m", "p"]);
    // Milestones hidden: the tasks behind the milestone are unreachable from A.
    const noMilestones = filterGraph(data, { types: ["project", "task"], rootId: "a", depth: 3 });
    expect(noMilestones.nodes.map((n) => n.ref.id)).toEqual(["a"]);
  });
  it("keeps the root even when its type is filtered out", () => {
    const shown = filterGraph(data, { types: ["task"], rootId: "m", depth: 1 });
    expect(shown.nodes.map((n) => n.ref.id).sort()).toEqual(["m", "t1", "t2"]);
  });
  it("ignores a root that is not in the data (for example one the viewer cannot read)", () => {
    const shown = filterGraph(data, { types: [], rootId: "hidden", depth: 1 });
    expect(shown.nodes).toHaveLength(6);
  });
});

describe("layoutGraph", () => {
  it("puts the root in the centre and is the same every time", () => {
    const first = layoutGraph(data, "m", 400);
    const second = layoutGraph(data, "m", 400);
    expect(first).toEqual(second);
    const root = first.find((n) => n.ref.id === "m")!;
    expect([root.x, root.y, root.ring]).toEqual([200, 200, 0]);
    for (const placed of first) {
      expect(placed.x).toBeGreaterThanOrEqual(0);
      expect(placed.x).toBeLessThanOrEqual(400);
      expect(placed.y).toBeGreaterThanOrEqual(0);
      expect(placed.y).toBeLessThanOrEqual(400);
    }
  });
  it("uses one ring per type without a root, in the order given", () => {
    const placed = layoutGraph(data, null, 400, ["program", "project", "milestone", "task"]);
    expect(placed.find((n) => n.ref.id === "p")!.ring).toBe(1);
    expect(placed.find((n) => n.ref.id === "t2")!.ring).toBe(4);
  });
});

describe("outlineGraph", () => {
  it("lists each object once from the root with the relation that reached it", () => {
    const [root] = outlineGraph(data, "a");
    expect(root.node.ref.id).toBe("a");
    expect(root.children.map((c) => [c.node.ref.id, c.via])).toEqual([
      ["m", { relationTypeKey: "contains", direction: "out" }],
      ["p", { relationTypeKey: "contains", direction: "in" }],
    ]);
    const milestone = root.children[0];
    expect(milestone.children.map((c) => c.node.title)).toEqual(["Book venue", "Send invites"]);
  });
  it("without a root lists every object with its direct links", () => {
    const items = outlineGraph(data, null);
    expect(items).toHaveLength(6);
    const t2 = items.find((i) => i.node.ref.id === "t2")!;
    expect(t2.children.map((c) => [c.node.ref.id, c.via?.relationTypeKey, c.via?.direction])).toEqual([
      ["t1", "blocks", "in"],
      ["m", "contains", "in"],
    ]);
  });
});
