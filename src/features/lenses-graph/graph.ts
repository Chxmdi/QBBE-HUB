import type { ObjectRef, ObjectTypeKey, Relation, Uuid } from "@/lib/objects/contracts";

/**
 * The graph lens model (V2-1): objects as nodes, relations as edges.
 *
 * Pure so filtering, layout and the accessible outline can be tested without a
 * database. The page supplies nodes and edges read under the viewer's RLS
 * (./graph.source.ts today, S4's query engine and S1's relation layer later).
 */

/**
 * Where an edge is stored. Extends `Relation["source"]` with the native links
 * the contract does not list yet (contract addition, see the PR).
 */
export type GraphEdgeSource =
  | Relation["source"]
  | "milestone_dependency"
  | "task_milestone"
  | "milestone_project"
  | "project_program";

export interface GraphEdge {
  /** e.g. `contains`, `blocks`. Read "from <key> to". */
  relationTypeKey: GraphRelationKey;
  from: ObjectRef;
  to: ObjectRef;
  source: GraphEdgeSource;
}

export const graphRelationKeys = ["contains", "blocks"] as const;
export type GraphRelationKey = (typeof graphRelationKeys)[number];

export interface GraphNode {
  ref: ObjectRef;
  title: string;
  /** Where the object opens, or null when it has no page of its own. */
  href: string | null;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const MAX_DEPTH = 3;

export interface GraphFilter {
  /** Types to keep. Empty keeps every type. */
  types: ObjectTypeKey[];
  /** The object the graph is drawn around, or null for everything. */
  rootId: Uuid | null;
  /** Relation steps from the root, 1 to MAX_DEPTH. Ignored without a root. */
  depth: number;
}

export function clampDepth(raw: unknown): number {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_DEPTH);
}

/** Node ids next to each node, in either direction. */
function adjacency(edges: GraphEdge[]): Map<Uuid, Set<Uuid>> {
  const map = new Map<Uuid, Set<Uuid>>();
  const add = (a: Uuid, b: Uuid) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const edge of edges) {
    add(edge.from.id, edge.to.id);
    add(edge.to.id, edge.from.id);
  }
  return map;
}

/** Steps from `rootId` to every node within `depth`, walking through kept types only. */
export function distancesFrom(
  data: GraphData,
  rootId: Uuid,
  depth: number,
  keep: (node: GraphNode) => boolean = () => true,
): Map<Uuid, number> {
  const byId = new Map(data.nodes.map((node) => [node.ref.id, node]));
  const root = byId.get(rootId);
  const distances = new Map<Uuid, number>();
  if (!root) return distances;
  const neighbours = adjacency(data.edges);
  distances.set(rootId, 0);
  let frontier = [rootId];
  for (let step = 1; step <= depth && frontier.length; step++) {
    const next: Uuid[] = [];
    for (const id of frontier) {
      for (const other of [...(neighbours.get(id) ?? [])].sort()) {
        const node = byId.get(other);
        if (!node || distances.has(other) || !keep(node)) continue;
        distances.set(other, step);
        next.push(other);
      }
    }
    frontier = next;
  }
  return distances;
}

/**
 * The part of the graph a filter asks for. Edges survive only when both ends
 * do, so a hidden type never leaves an edge pointing at nothing. The root is
 * always kept, even when its own type is filtered out, so the view never
 * loses the object it is centred on.
 */
export function filterGraph(data: GraphData, filter: GraphFilter): GraphData {
  const types = new Set(filter.types);
  const typeKept = (node: GraphNode) => types.size === 0 || types.has(node.ref.type);
  let kept: Set<Uuid>;
  if (filter.rootId && data.nodes.some((node) => node.ref.id === filter.rootId)) {
    kept = new Set(distancesFrom(data, filter.rootId, clampDepth(filter.depth), typeKept).keys());
  } else {
    kept = new Set(data.nodes.filter(typeKept).map((node) => node.ref.id));
  }
  return {
    nodes: data.nodes.filter((node) => kept.has(node.ref.id)),
    edges: data.edges.filter((edge) => kept.has(edge.from.id) && kept.has(edge.to.id)),
  };
}

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  /** Ring number: steps from the root, or the type's ring without a root. */
  ring: number;
}

/**
 * A deterministic radial layout: the root in the middle and each further step
 * on a wider ring, or one ring per type when there is no root. Deterministic
 * so the same data always draws the same picture, which a force layout does
 * not, and cheap enough to run on the server for a few hundred objects.
 */
export function layoutGraph(
  data: GraphData,
  rootId: Uuid | null,
  size: number,
  typeOrder: readonly ObjectTypeKey[] = [],
): PlacedNode[] {
  const centre = size / 2;
  const rings = new Map<number, GraphNode[]>();
  if (rootId && data.nodes.some((node) => node.ref.id === rootId)) {
    const distances = distancesFrom(data, rootId, Number.MAX_SAFE_INTEGER);
    for (const node of data.nodes) {
      const ring = distances.get(node.ref.id) ?? MAX_DEPTH + 1;
      rings.set(ring, [...(rings.get(ring) ?? []), node]);
    }
  } else {
    const order = [...typeOrder, ...new Set(data.nodes.map((node) => node.ref.type))];
    for (const node of data.nodes) {
      const ring = order.indexOf(node.ref.type) + 1;
      rings.set(ring, [...(rings.get(ring) ?? []), node]);
    }
  }
  const ringNumbers = [...rings.keys()].sort((a, b) => a - b);
  const outer = ringNumbers.filter((ring) => ring > 0).length || 1;
  const step = (centre - 40) / outer;
  const placed: PlacedNode[] = [];
  ringNumbers.forEach((ring, index) => {
    const members = rings.get(ring)!.sort(
      (a, b) => a.ref.type.localeCompare(b.ref.type) || a.title.localeCompare(b.title) || a.ref.id.localeCompare(b.ref.id),
    );
    const radius = ring === 0 ? 0 : step * (ringNumbers[0] === 0 ? index : index + 1);
    // Offset alternate rings so their labels do not line up on one spoke.
    const offset = index % 2 === 0 ? 0 : Math.PI / Math.max(members.length, 1);
    members.forEach((node, position) => {
      const angle = offset + (2 * Math.PI * position) / members.length - Math.PI / 2;
      placed.push({
        ...node,
        ring,
        x: Math.round((centre + radius * Math.cos(angle)) * 10) / 10,
        y: Math.round((centre + radius * Math.sin(angle)) * 10) / 10,
      });
    });
  });
  return placed;
}

/** One line of the accessible outline: an object and how it is reached. */
export interface OutlineItem {
  node: GraphNode;
  /** How this object relates to its parent in the outline, read from the parent. */
  via: { relationTypeKey: GraphRelationKey; direction: "out" | "in" } | null;
  children: OutlineItem[];
}

/**
 * The graph as nested lists for keyboard and screen-reader use. From a root:
 * a breadth-first spanning tree, each object listed once at its shortest
 * distance, with the relation that reached it. Without a root: every object
 * at the top level with its direct relations beneath it, one level deep.
 */
export function outlineGraph(data: GraphData, rootId: Uuid | null): OutlineItem[] {
  const byId = new Map(data.nodes.map((node) => [node.ref.id, node]));
  const links = new Map<Uuid, { other: Uuid; key: GraphRelationKey; direction: "out" | "in" }[]>();
  const push = (id: Uuid, link: { other: Uuid; key: GraphRelationKey; direction: "out" | "in" }) =>
    links.set(id, [...(links.get(id) ?? []), link]);
  for (const edge of data.edges) {
    push(edge.from.id, { other: edge.to.id, key: edge.relationTypeKey, direction: "out" });
    push(edge.to.id, { other: edge.from.id, key: edge.relationTypeKey, direction: "in" });
  }
  const sortedLinks = (id: Uuid) =>
    [...(links.get(id) ?? [])]
      .filter((link) => byId.has(link.other))
      .sort((a, b) => byId.get(a.other)!.title.localeCompare(byId.get(b.other)!.title) || a.other.localeCompare(b.other));

  if (rootId && byId.has(rootId)) {
    const seen = new Set<Uuid>([rootId]);
    const root: OutlineItem = { node: byId.get(rootId)!, via: null, children: [] };
    let frontier = [root];
    while (frontier.length) {
      const next: OutlineItem[] = [];
      for (const item of frontier) {
        for (const link of sortedLinks(item.node.ref.id)) {
          if (seen.has(link.other)) continue;
          seen.add(link.other);
          const child: OutlineItem = {
            node: byId.get(link.other)!,
            via: { relationTypeKey: link.key, direction: link.direction },
            children: [],
          };
          item.children.push(child);
          next.push(child);
        }
      }
      frontier = next;
    }
    return [root];
  }

  return [...data.nodes]
    .sort((a, b) => a.ref.type.localeCompare(b.ref.type) || a.title.localeCompare(b.title))
    .map((node) => ({
      node,
      via: null,
      children: sortedLinks(node.ref.id).map((link) => ({
        node: byId.get(link.other)!,
        via: { relationTypeKey: link.key, direction: link.direction },
        children: [],
      })),
    }));
}
