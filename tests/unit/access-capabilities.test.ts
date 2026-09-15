import { describe, expect, it } from "vitest";
import {
  programAccessRoleSchema,
  programRoleAllows,
  projectAccessRoleSchema,
  projectRoleAllows,
  recordCapabilitySchema,
} from "@/lib/access-capabilities";

describe("typed scoped capabilities", () => {
  it("keeps read-only and follower grants free of operational writes", () => {
    for (const role of ["read_only", "follower"] as const) {
      expect(programRoleAllows(role, "read")).toBe(true);
      expect(programRoleAllows(role, "manage")).toBe(false);
      expect(programRoleAllows(role, "collaborate")).toBe(false);
      expect(projectRoleAllows(role, "read")).toBe(true);
      expect(projectRoleAllows(role, "approve")).toBe(false);
    }
  });

  it("separates contributor, reviewer and approver authority", () => {
    expect(projectRoleAllows("contributor", "collaborate")).toBe(true);
    expect(projectRoleAllows("contributor", "review")).toBe(false);
    expect(projectRoleAllows("reviewer", "review")).toBe(true);
    expect(projectRoleAllows("reviewer", "collaborate")).toBe(false);
    expect(projectRoleAllows("approver", "approve")).toBe(true);
    expect(projectRoleAllows("approver", "manage")).toBe(false);
  });

  it("allows accountable managers to perform the complete record lifecycle", () => {
    for (const capability of ["read", "manage", "collaborate", "review", "approve", "follow"] as const) {
      expect(programRoleAllows("lead", capability)).toBe(true);
      expect(projectRoleAllows("project_manager", capability)).toBe(true);
    }
  });

  it("rejects unknown persisted roles and capability strings", () => {
    expect(programAccessRoleSchema.safeParse("member").success).toBe(false);
    expect(projectAccessRoleSchema.safeParse("manager").success).toBe(false);
    expect(recordCapabilitySchema.safeParse("delete_everything").success).toBe(false);
  });
});
