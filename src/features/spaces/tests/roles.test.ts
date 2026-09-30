import { describe, expect, it } from "vitest";
import { bitsFromCapabilities, capabilitiesFromBits, roleKeyFromName } from "../services/roles";

describe("role capability bits", () => {
  it("match app.cap_bit and always include view", () => {
    expect(bitsFromCapabilities(["comment", "share"])).toBe(1 | 2 | 64);
    expect(bitsFromCapabilities(["view", "edit_content", "manage"])).toBe(1 | 4 | 16);
  });

  it("ignore unknown names and give nothing for nothing", () => {
    expect(bitsFromCapabilities(["delete_everything"])).toBe(0);
    expect(bitsFromCapabilities([])).toBe(0);
  });

  it("round-trip in the contract's order", () => {
    expect(capabilitiesFromBits(127)).toEqual([
      "view", "comment", "edit_content", "edit_structure", "manage", "run_workflow", "share",
    ]);
    expect(capabilitiesFromBits(bitsFromCapabilities(["share", "comment"]))).toEqual(["view", "comment", "share"]);
    // Today's record words (review 128, follow 1024) are not Workspace OS capabilities.
    expect(capabilitiesFromBits(128 | 1024)).toEqual([]);
  });
});

describe("roleKeyFromName", () => {
  it("makes a lower snake case key the table accepts", () => {
    const key = roleKeyFromName("Comité — Révision 2026!", "AB12-cd34");
    expect(key).toBe("comite_revision_2026_ab12cd34");
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
  });

  it("falls back when the name has no letters to start with", () => {
    expect(roleKeyFromName("2026", "x1")).toMatch(/^role_x1$/);
    expect(roleKeyFromName("!!!", "x1")).toBe("role_x1");
  });
});
