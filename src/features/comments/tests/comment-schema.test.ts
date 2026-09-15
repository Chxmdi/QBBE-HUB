import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("contextual comments", () => {
  it("defines a parent-validated comment table rather than task-only comments", () => {
    const sql = readFileSync(
      "supabase/migrations/20260912040000_prd_workstream_completion.sql",
      "utf8",
    );
    expect(sql).toContain("create table if not exists public.record_comment");
    for (const parent of [
      "project", "task", "milestone", "event", "meeting", "agenda_item",
      "risk", "issue", "update", "organization", "contact", "opportunity",
    ]) {
      expect(sql).toContain(`'${parent}'`);
    }
    expect(sql).toContain("can_read_comment_parent");
  });
});
