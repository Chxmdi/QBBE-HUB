import { describe, expect, it } from "vitest";
import { buildAccessImpact, type AccessImpactInput } from "../access-impact";

function fixture(): AccessImpactInput {
  return {
    organizationId: "org",
    members: ["owner", "staff", "lead", "volunteer", "guest", "inactive"].map(id => ({
      user_id: id, organization_id: "org", role: ["lead", "inactive"].includes(id) ? "staff" : id,
      status: id === "inactive" ? "deactivated" : "active", name: id,
    })),
    programs: [{ id: "a", organization_id: "org", name: "A", lead_id: "lead", status: "active" }],
    projects: [
      { id: "x", organization_id: "org", name: "X", program_id: "a", owner_id: "inactive", stage: "active", archived_at: null },
      { id: "y", organization_id: "org", name: "Y", program_id: null, owner_id: "owner", stage: "active", archived_at: null },
    ],
    programMemberships: [], projectMemberships: [],
  };
}
describe("proposed access impact", () => {
  it("does not backfill broad staff access and preserves administrators", () => {
    const result = buildAccessImpact(fixture());
    expect(result.members.find(m => m.userId === "staff")).toMatchObject({ grants: [], losingManagement: 3 });
    expect(result.members.find(m => m.userId === "owner")?.grants).toHaveLength(3);
    expect(result.members.find(m => m.userId === "owner")?.grants.every(g => g.manage)).toBe(true);
  });
  it("inherits program lead access only to that program's projects", () => {
    const member = buildAccessImpact(fixture()).members.find(m => m.userId === "lead")!;
    expect(member.grants.map(g => g.id)).toEqual(["a", "x"]);
    expect(member.grants.every(g => g.manage)).toBe(true);
  });
  it("direct project membership does not grant parent or sibling access", () => {
    const input = fixture(); input.projectMemberships.push({ project_id: "x", user_id: "volunteer", role: "member" });
    const grants = buildAccessImpact(input).members.find(m => m.userId === "volunteer")!.grants;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ id: "x", manage: false });
  });
  it("guest remains read-only even with a manager membership", () => {
    const input = fixture(); input.programMemberships.push({ program_id: "a", user_id: "guest", role: "manager" });
    const grants = buildAccessImpact(input).members.find(m => m.userId === "guest")!.grants;
    expect(grants).toHaveLength(2); expect(grants.some(g => g.manage)).toBe(false);
  });
  it("flags a read-only guest steward before a permission cutover", () => {
    const input = fixture(); input.programs[0].lead_id = "guest"; input.projects[1].owner_id = "guest";
    const result = buildAccessImpact(input);
    expect(result.issues.filter(issue => issue.includes("read-only organization member"))).toHaveLength(2);
    expect(result.members.find(m => m.userId === "guest")!.grants.some(g => g.manage)).toBe(false);
  });
  it("gives a leadership viewer portfolio read access without management", () => {
    const input = fixture();
    input.members.push({ user_id: "viewer", organization_id: "org", role: "leadership_viewer", status: "active", name: "Viewer" });
    const viewer = buildAccessImpact(input).members.find(m => m.userId === "viewer")!;
    expect(viewer.grants).toHaveLength(3);
    expect(viewer.grants.every(grant => !grant.manage)).toBe(true);
    expect(viewer.losingRead).toEqual([]);
    expect(viewer.losingManagement).toBe(0);
  });
  it("excludes inactive and foreign members and identifies inactive owners", () => {
    const input = fixture(); input.members.push({ user_id: "outsider", organization_id: "foreign", name: "Foreign", status: "active", role: "admin" });
    input.programs.push({ id: "foreign", organization_id: "foreign", name: "Foreign", status: "active", lead_id: "owner" });
    const result = buildAccessImpact(input);
    expect(result.members.map(m => m.userId)).not.toContain("inactive");
    expect(result.members.map(m => m.userId)).not.toContain("outsider");
    expect(result.members.flatMap(m => m.grants).some(g => g.id === "foreign")).toBe(false);
    expect(result.issues).toContain('Project “X” needs an active owner.');
  });
  it("treats persisted grants as live sources", () => {
    const input = fixture();
    input.programGrants = [{ program_id: "a", user_id: "volunteer", role: "contributor" }];
    input.projectGrants = [{ project_id: "y", user_id: "volunteer", role: "project_manager" }];
    const volunteer = buildAccessImpact(input).members.find(m => m.userId === "volunteer")!;
    expect(volunteer.grants.map(g => g.id).sort()).toEqual(["a", "x", "y"]);
    expect(volunteer.grants.find(g => g.id === "y")?.manage).toBe(true);
    expect(volunteer.grants.find(g => g.id === "a")?.sources.join(" ")).toContain("persisted grant");
  });
  it("preserves independent grant sources and flags unknown roles without management", () => {
    const input = fixture();
    input.projectMemberships.push({ project_id: "x", user_id: "lead", role: "member" }, { project_id: "y", user_id: "volunteer", role: "superuser" });
    const result = buildAccessImpact(input);
    expect(result.members.find(m => m.userId === "lead")!.grants.find(g => g.id === "x")!.sources).toHaveLength(2);
    expect(result.members.find(m => m.userId === "volunteer")!.grants[0].manage).toBe(false);
    expect(result.issues.some(issue => issue.includes("superuser"))).toBe(true);
  });
});
