import { describe, expect, it } from "vitest";
import { groupSpaces, spaceName, toSpace, type SpaceRow } from "../services/spaces";

function row(overrides: Partial<SpaceRow>): SpaceRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    organization_id: "org",
    kind: "custom",
    program_id: null,
    owner_id: null,
    name_en: "Board",
    name_fr: "Conseil",
    description: null,
    icon: null,
    archived_at: null,
    capabilities: [],
    ...overrides,
  };
}

describe("toSpace", () => {
  it("keeps known capabilities in the contract's order and drops unknown ones", () => {
    const space = toSpace(row({ capabilities: ["share", "view", "delete_everything", "comment"] }));
    expect(space?.capabilities).toEqual(["view", "comment", "share"]);
  });

  it("drops rows of an unknown kind rather than trusting them", () => {
    expect(toSpace(row({ kind: "galaxy" }))).toBeNull();
  });

  it("treats a null capability list as no access", () => {
    expect(toSpace(row({ capabilities: null }))?.capabilities).toEqual([]);
  });
});

describe("spaceName", () => {
  it("reads the name in the person's language", () => {
    const space = toSpace(row({}))!;
    expect(spaceName(space, "en")).toBe("Board");
    expect(spaceName(space, "fr-CA")).toBe("Conseil");
  });
});

describe("groupSpaces", () => {
  it("groups by kind, sorts by name in the language, and puts archived spaces last", () => {
    const spaces = [
      row({ id: "w", kind: "workspace", name_en: "Workspace", name_fr: "Espace de travail" }),
      row({ id: "p1", kind: "program", program_id: "p1", name_en: "Zeta", name_fr: "Zeta" }),
      row({ id: "p2", kind: "program", program_id: "p2", name_en: "Alpha", name_fr: "Alpha", archived_at: "2026-01-01" }),
      row({ id: "p3", kind: "program", program_id: "p3", name_en: "Mu", name_fr: "Mu" }),
      row({ id: "me", kind: "private", owner_id: "u", name_en: "Private", name_fr: "Privé" }),
      row({ id: "c1", name_en: "Board", name_fr: "Conseil" }),
      row({ id: "c2", name_en: "Admin", name_fr: "Zadmin" }),
    ].map((value) => toSpace(value)!);

    const en = groupSpaces(spaces, "en");
    expect(en.workspace.map((s) => s.id)).toEqual(["w"]);
    expect(en.private.map((s) => s.id)).toEqual(["me"]);
    expect(en.programs.map((s) => s.id)).toEqual(["p3", "p1", "p2"]);
    expect(en.custom.map((s) => s.id)).toEqual(["c2", "c1"]);
    expect(groupSpaces(spaces, "fr-CA").custom.map((s) => s.id)).toEqual(["c1", "c2"]);
  });
});
