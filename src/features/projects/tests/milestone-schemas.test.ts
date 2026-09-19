import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MILESTONE_STATUSES,
  compareMilestones,
  completeMilestoneSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
} from "@/features/projects/schemas";

const PROJECT = "11111111-1111-1111-1111-111111111111";
const MILESTONE = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

describe("createMilestoneSchema", () => {
  it("rejects an empty name", () => {
    const parsed = createMilestoneSchema.safeParse({ projectId: PROJECT, name: "  " });
    expect(parsed.success).toBe(false);
  });

  it("accepts a named milestone", () => {
    const parsed = createMilestoneSchema.safeParse({
      projectId: PROJECT,
      name: "Kickoff",
      dueDate: "2026-09-01",
    });
    expect(parsed.success).toBe(true);
  });

  it("carries the owner and description the table has always had columns for", () => {
    const parsed = createMilestoneSchema.safeParse({
      projectId: PROJECT,
      name: "Venue confirmed",
      description: "Signed contract in hand.",
      ownerId: PERSON,
      status: "in_progress",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ownerId).toBe(PERSON);
      expect(parsed.data.status).toBe("in_progress");
    }
  });

  it("treats an unset owner as empty rather than an invalid uuid", () => {
    // The select posts "" for "Nobody named". Without the empty-string branch
    // this fails validation and the whole form is refused for a blank field.
    expect(
      createMilestoneSchema.safeParse({ projectId: PROJECT, name: "X", ownerId: "" })
        .success,
    ).toBe(true);
  });

  it("cannot create a milestone that is already completed", () => {
    // Completion requires evidence, and a create form that offered `completed`
    // would be a second way in that never asks for any.
    expect(
      createMilestoneSchema.safeParse({
        projectId: PROJECT,
        name: "X",
        status: "completed",
      }).success,
    ).toBe(false);
  });
});

describe("completing a milestone", () => {
  it("refuses a completion with nothing to show for it", () => {
    const parsed = completeMilestoneSchema.safeParse({
      milestoneId: MILESTONE,
      completed: true,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/shows this milestone was met/);
    }
  });

  it("accepts a completion with evidence", () => {
    expect(
      completeMilestoneSchema.safeParse({
        milestoneId: MILESTONE,
        completed: true,
        evidence: "Signed venue contract, filed under Documents.",
      }).success,
    ).toBe(true);
  });

  it("asks for nothing to reopen one", () => {
    expect(
      completeMilestoneSchema.safeParse({ milestoneId: MILESTONE, completed: false })
        .success,
    ).toBe(true);
  });
});

describe("editing a milestone", () => {
  it("cannot set completed, so the evidence rule has one way in", () => {
    expect(
      updateMilestoneSchema.safeParse({ milestoneId: MILESTONE, status: "completed" })
        .success,
    ).toBe(false);
  });

  it("agrees with the database about which statuses exist", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260912040000_prd_workstream_completion.sql"),
      "utf8",
    );
    const constraint = sql.slice(sql.indexOf("milestone_status_check"));
    for (const status of MILESTONE_STATUSES) {
      expect(constraint).toContain(`'${status}'`);
    }
  });
});

describe("the order milestones are read in", () => {
  const at = (sort_key: number, due_date: string | null, name = "m") => ({
    sort_key,
    due_date,
    name,
  });

  it("puts the arranged order first", () => {
    expect(compareMilestones(at(1, "2026-12-01"), at(2, "2026-01-01"))).toBeLessThan(0);
  });

  it("falls back to the date when nobody has arranged them", () => {
    // Every milestone created before this shipped sits on the default 0, so
    // the tie-break is the common case rather than the edge case.
    expect(compareMilestones(at(0, "2026-01-01"), at(0, "2026-02-01"))).toBeLessThan(0);
  });

  it("sorts an undated milestone last, not first", () => {
    // A null date is unscheduled, not overdue since the beginning of time.
    expect(compareMilestones(at(0, null), at(0, "2026-01-01"))).toBeGreaterThan(0);
    expect(compareMilestones(at(0, "2026-01-01"), at(0, null))).toBeLessThan(0);
  });

  it("is total, so the result never depends on what the database returned", () => {
    expect(compareMilestones(at(0, "2026-01-01", "a"), at(0, "2026-01-01", "b")))
      .toBeLessThan(0);
    expect(compareMilestones(at(0, null, "a"), at(0, null, "a"))).toBe(0);
  });

  it("produces a stable full ordering", () => {
    const rows = [
      at(0, null, "undated"),
      at(2, "2026-05-01", "second"),
      at(1, "2026-09-01", "first"),
      at(0, "2026-03-01", "unarranged"),
    ];
    expect([...rows].sort(compareMilestones).map((r) => r.name)).toEqual([
      "unarranged",
      "undated",
      "first",
      "second",
    ]);
  });
});
