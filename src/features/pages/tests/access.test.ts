import { describe, expect, it } from "vitest";
import {
  canCreatePrivatePages,
  canCreateWorkspacePages,
  canEditPage,
  canReadWorkspacePages,
} from "@/features/pages/access";

const roles = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;

describe("page access hints (mirror app.can_write_page_row)", () => {
  it("lets staff and above create shared pages", () => {
    expect(roles.filter((role) => canCreateWorkspacePages({ userId: "u", role }))).toEqual(["owner", "admin", "staff"]);
  });

  it("lets volunteers create private pages but not guests or leadership viewers", () => {
    expect(roles.filter((role) => canCreatePrivatePages({ userId: "u", role }))).toEqual([
      "owner",
      "admin",
      "staff",
      "volunteer",
    ]);
  });

  it("shows shared pages to staff-level readers only", () => {
    expect(roles.filter((role) => canReadWorkspacePages({ userId: "u", role }))).toEqual([
      "owner",
      "admin",
      "leadership_viewer",
      "staff",
    ]);
  });

  it("offers editing a private page to its creator only, and never a trashed page", () => {
    const mine = { visibility: "private" as const, createdBy: "u", deletedAt: null };
    expect(canEditPage({ userId: "u", role: "volunteer" }, mine)).toBe(true);
    expect(canEditPage({ userId: "other", role: "owner" }, mine)).toBe(false);
    expect(canEditPage({ userId: "u", role: "guest" }, mine)).toBe(false);
    expect(canEditPage({ userId: "u", role: "staff" }, { ...mine, deletedAt: "2026-09-30" })).toBe(false);
    expect(canEditPage({ userId: "x", role: "staff" }, { ...mine, visibility: "workspace" })).toBe(true);
    expect(canEditPage({ userId: "x", role: "volunteer" }, { ...mine, visibility: "workspace" })).toBe(false);
  });
});
