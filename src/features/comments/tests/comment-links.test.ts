import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commentParentPath, resolveCommentPath } from "@/features/comments/comment-links";
import { FakeSupabase, asClient } from "../../../../tests/support/fake-supabase";

/** The app route a path renders, so a link to a page that does not exist fails here. */
function pageExists(path: string): boolean {
  const segments = path.split("?")[0].split("/").filter(Boolean);
  // Every link here is `/section` or `/section/<record id>`.
  const dir = segments.map((segment, index) => (index > 0 ? "[id]" : segment));
  return existsSync(join(process.cwd(), "src/app/(workspace)", ...dir, "page.tsx"));
}

describe("a comment mention opens the record the comment is on", () => {
  it.each([
    [{ type: "project", id: "p1" }, "/projects/p1"],
    [{ type: "task", id: "t1" }, "/my-work?task=t1"],
    [{ type: "event", id: "e1" }, "/events/e1"],
    [{ type: "meeting", id: "m1" }, "/meetings/m1"],
    [{ type: "organization", id: "o1" }, "/crm/o1"],
    [{ type: "milestone", id: "x", projectId: "p1" }, "/projects/p1"],
    [{ type: "update", id: "x", projectId: "p1" }, "/projects/p1"],
    [{ type: "risk", id: "r1", projectId: "p1" }, "/projects/p1?tab=risks&risk=r1"],
    [{ type: "issue", id: "r1", projectId: "p1" }, "/projects/p1?tab=risks&issue=r1"],
    [{ type: "agenda_item", id: "x", meetingId: "m1" }, "/meetings/m1"],
    [{ type: "contact", id: "x", crmOrganizationId: "o1" }, "/crm/o1"],
    [{ type: "opportunity", id: "op1", crmOrganizationId: "o1" }, "/crm/o1?tab=opportunities&opportunity=op1"],
  ])("%o opens %s, a page that exists", (parent, expected) => {
    const path = commentParentPath(parent);
    expect(path).toBe(expected);
    expect(pageExists(path!)).toBe(true);
  });

  it("gives no link rather than a wrong one when the parent's parent is unknown", () => {
    expect(commentParentPath({ type: "risk", id: "r1" })).toBeNull();
    expect(commentParentPath({ type: "unheard-of", id: "x" })).toBeNull();
  });

  it("resolves a stored comment through its parent's own parent", async () => {
    const db = new FakeSupabase();
    db.seed("record_comment", [{ id: "c1", parent_type: "agenda_item", parent_id: "a1" }]);
    db.seed("agenda_item", [{ id: "a1", meeting_id: "m1" }]);
    await expect(resolveCommentPath(asClient(db), "c1")).resolves.toBe("/meetings/m1");
  });

  it("reveals nothing about a comment the reader cannot see", async () => {
    const db = new FakeSupabase();
    db.seed("record_comment", []);
    await expect(resolveCommentPath(asClient(db), "c1")).resolves.toBeNull();
  });

  it("reveals nothing when the parent record is hidden from the reader", async () => {
    const db = new FakeSupabase();
    db.seed("record_comment", [{ id: "c1", parent_type: "risk", parent_id: "r1" }]);
    db.seed("risk", []);
    await expect(resolveCommentPath(asClient(db), "c1")).resolves.toBeNull();
  });
});
