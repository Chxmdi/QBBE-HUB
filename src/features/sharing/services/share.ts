/**
 * Share menu (M10f): who has access to a space or page, and where that
 * access comes from. Pure, so the rules are unit-tested; the database still
 * decides everything (grants are read and written through RLS).
 */

export const principalKinds = ["person", "team", "org_role"] as const;
export type PrincipalKind = (typeof principalKinds)[number];
export const grantReaches = ["subtree", "self", "self_and_child_tasks"] as const;
export type GrantReach = (typeof grantReaches)[number];

/** What a node in the parent chain is, for "inherited from …". */
export type NodeKind = "workspace" | "program" | "private" | "custom" | "project" | "task" | "object";

export interface ShareNode {
  id: string;
  kind: NodeKind;
  /** Null when the reader cannot read its name. */
  name: string | null;
}

export interface GrantRow {
  id: string;
  object_id: string;
  principal_kind: PrincipalKind;
  user_id: string | null;
  team_id: string | null;
  org_role: string | null;
  role_id: string;
  reach: GrantReach;
  source: string;
}

export interface ShareEntry {
  grantId: string;
  principal: { kind: PrincipalKind; id: string; label: string };
  roleId: string;
  roleLabel: string;
  reach: GrantReach;
  /** Null when the grant is on this node itself. */
  inheritedFrom: ShareNode | null;
  /** Mirrors today's program or project access, or a space's owner (not changed here). */
  mirrored: boolean;
  /** Where the grant comes from: `direct`, or the table or column it mirrors. */
  source: string;
  /** The reader may change or remove it. */
  editable: boolean;
}

/** Whether a grant on the ancestor at `depth` (0 = the node itself) reaches the node. */
export function grantReachesNode(reach: GrantReach, depth: number, nodeKind: NodeKind): boolean {
  if (depth === 0) return true;
  if (reach === "subtree") return true;
  return reach === "self_and_child_tasks" && depth === 1 && nodeKind === "task";
}

export interface BuildShareEntriesInput {
  /** The node first, then its parent, grandparent and so on. */
  ancestors: string[];
  nodes: Map<string, ShareNode>;
  grants: GrantRow[];
  canShare: boolean;
  principalLabel: (grant: GrantRow) => string;
  roleLabel: (roleId: string) => string;
}

export function buildShareEntries(input: BuildShareEntriesInput): ShareEntry[] {
  const [self] = input.ancestors;
  const selfNode = input.nodes.get(self);
  const depthOf = new Map(input.ancestors.map((id, index) => [id, index]));
  const entries: (ShareEntry & { depth: number })[] = [];

  for (const grant of input.grants) {
    const depth = depthOf.get(grant.object_id);
    if (depth === undefined) continue;
    if (!grantReachesNode(grant.reach, depth, selfNode?.kind ?? "object")) continue;
    const principalId = grant.user_id ?? grant.team_id ?? grant.org_role ?? "";
    const mirrored = grant.source !== "direct";
    entries.push({
      depth,
      grantId: grant.id,
      principal: { kind: grant.principal_kind, id: principalId, label: input.principalLabel(grant) },
      roleId: grant.role_id,
      roleLabel: input.roleLabel(grant.role_id),
      reach: grant.reach,
      inheritedFrom:
        depth === 0 ? null : (input.nodes.get(grant.object_id) ?? { id: grant.object_id, kind: "object", name: null }),
      mirrored,
      source: grant.source,
      editable: depth === 0 && !mirrored && input.canShare,
    });
  }

  return entries
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        principalKinds.indexOf(a.principal.kind) - principalKinds.indexOf(b.principal.kind) ||
        a.principal.label.localeCompare(b.principal.label),
    )
    .map((entry) => {
      const { depth, ...rest } = entry;
      void depth;
      return rest;
    });
}

/** Whether people may add grants on this node (the database checks again). */
export function isShareableNode(kind: NodeKind): boolean {
  return kind === "workspace" || kind === "custom" || kind === "object";
}
