import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createActions } from "@/config/create-actions";

describe("create actions (P0-QC-01, P0-CMD-01)", () => {
  it("offers a member or volunteer a task and a project proposal, not just a task", () => {
    expect(createActions({ isAdmin: false, isStaff: false }).map((a) => a.label)).toEqual([
      "Task",
      "Project proposal",
    ]);
  });

  it("adds staff and admin creation by role", () => {
    const staff = createActions({ isAdmin: false, isStaff: true }).map((a) => a.label);
    expect(staff).toEqual(expect.arrayContaining(["Project", "Meeting", "CRM follow-up"]));
    expect(staff).not.toContain("Announcement");
    expect(createActions({ isAdmin: true, isStaff: true }).map((a) => a.label)).toContain("Announcement");
  });

  it("points every action at a workspace page that exists", () => {
    for (const action of createActions({ isAdmin: true, isStaff: true })) {
      const route = action.href.split("?")[0];
      expect(
        existsSync(join(process.cwd(), "src/app/(workspace)", route, "page.tsx")),
        action.href,
      ).toBe(true);
    }
  });
});
