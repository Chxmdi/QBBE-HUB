import { describe, expect, it } from "vitest";
import { buildShareEntries, grantReachesNode, isShareableNode, type GrantRow, type ShareNode } from "../services/share";

const page: ShareNode = { id: "page", kind: "object", name: "Handbook" };
const parent: ShareNode = { id: "parent", kind: "object", name: "Policies" };
const space: ShareNode = { id: "space", kind: "custom", name: "Board" };
const nodes = new Map([page, parent, space].map((node) => [node.id, node]));

function grant(overrides: Partial<GrantRow>): GrantRow {
  return {
    id: overrides.id ?? "g",
    object_id: "page",
    principal_kind: "person",
    user_id: "u1",
    team_id: null,
    org_role: null,
    role_id: "viewer",
    reach: "subtree",
    source: "direct",
    ...overrides,
  };
}

const names: Record<string, string> = { u1: "Ada", u2: "Bea", t1: "Finance team", staff: "Staff" };
const labels = {
  principalLabel: (g: GrantRow) => names[g.user_id ?? g.team_id ?? g.org_role ?? ""] ?? "?",
  roleLabel: (id: string) => ({ viewer: "Can view", editor: "Can edit" })[id] ?? id,
};

describe("grantReachesNode", () => {
  it("always reaches the node it is on", () => {
    expect(grantReachesNode("self", 0, "object")).toBe(true);
  });
  it("reaches below only when it includes everything inside", () => {
    expect(grantReachesNode("subtree", 3, "object")).toBe(true);
    expect(grantReachesNode("self", 1, "object")).toBe(false);
  });
  it("the program lead's reach stops at the program's own tasks", () => {
    expect(grantReachesNode("self_and_child_tasks", 1, "task")).toBe(true);
    expect(grantReachesNode("self_and_child_tasks", 1, "project")).toBe(false);
    expect(grantReachesNode("self_and_child_tasks", 2, "task")).toBe(false);
  });
});

describe("buildShareEntries", () => {
  const entries = buildShareEntries({
    ancestors: ["page", "parent", "space"],
    nodes,
    canShare: true,
    grants: [
      grant({ id: "space-staff", object_id: "space", principal_kind: "org_role", user_id: null, org_role: "staff" }),
      grant({ id: "parent-self", object_id: "parent", user_id: "u2", reach: "self" }),
      grant({ id: "parent-team", object_id: "parent", principal_kind: "team", user_id: null, team_id: "t1", role_id: "editor" }),
      grant({ id: "here", user_id: "u1", role_id: "editor" }),
      grant({ id: "here-mirrored", user_id: "u2", source: "space.owner_id" }),
      grant({ id: "elsewhere", object_id: "other" }),
    ],
    ...labels,
  });

  it("lists grants here first, then inherited ones nearest first, skipping what does not reach", () => {
    expect(entries.map((e) => e.grantId)).toEqual(["here", "here-mirrored", "parent-team", "space-staff"]);
  });

  it("names where inherited access comes from", () => {
    expect(entries.find((e) => e.grantId === "space-staff")?.inheritedFrom).toEqual(space);
    expect(entries.find((e) => e.grantId === "here")?.inheritedFrom).toBeNull();
  });

  it("lets the reader change only direct grants made here, never mirrored or inherited ones", () => {
    expect(entries.filter((e) => e.editable).map((e) => e.grantId)).toEqual(["here"]);
    expect(entries.find((e) => e.grantId === "here-mirrored")?.mirrored).toBe(true);
  });

  it("changes nothing for someone who cannot share", () => {
    const readOnly = buildShareEntries({ ancestors: ["page"], nodes, canShare: false, grants: [grant({})], ...labels });
    expect(readOnly[0].editable).toBe(false);
  });

  it("keeps an ancestor the reader cannot name, without its name", () => {
    const hiddenAncestor = buildShareEntries({
      ancestors: ["page", "secret"],
      nodes,
      canShare: true,
      grants: [grant({ id: "x", object_id: "secret" })],
      ...labels,
    });
    expect(hiddenAncestor[0].inheritedFrom).toEqual({ id: "secret", kind: "object", name: null });
  });
});

describe("isShareableNode", () => {
  it("allows the workspace, custom spaces and pages; not programs, private spaces or native records", () => {
    expect(isShareableNode("workspace") && isShareableNode("custom") && isShareableNode("object")).toBe(true);
    expect(isShareableNode("program") || isShareableNode("private") || isShareableNode("project") || isShareableNode("task")).toBe(false);
  });
});
