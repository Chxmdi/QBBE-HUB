import { describe, expect, it } from "vitest";
import { attentionReasons, sortForAttention, type TeamOverviewRow } from "../team-overview";

const base: TeamOverviewRow = {
  user_id: "u1",
  organization_id: "o1",
  role: "staff",
  full_name: "Sam Rivera",
  avatar_url: null,
  title: null,
  open_tasks: 4,
  overdue: 0,
  oldest_overdue_due: null,
  due_this_week: 1,
  blocked: 0,
  blocked_stale: 0,
  in_progress_stale: 0,
  completed_7: 2,
  completed_prev_7: 1,
  completed_30: 5,
  open_decisions: 0,
  overdue_decisions: 0,
  last_activity_at: null,
};

describe("attentionReasons", () => {
  it("says nothing about someone who is on track", () => {
    expect(attentionReasons(base, "2026-09-26")).toEqual([]);
  });

  it("does not flag one or two recently overdue tasks", () => {
    expect(
      attentionReasons({ ...base, overdue: 2, oldest_overdue_due: "2026-09-22" }, "2026-09-26"),
    ).toEqual([]);
  });

  it("flags three overdue tasks, with the oldest age", () => {
    expect(
      attentionReasons({ ...base, overdue: 3, oldest_overdue_due: "2026-09-24" }, "2026-09-26"),
    ).toEqual(["3 tasks overdue, oldest 2 days"]);
  });

  it("flags a single task overdue by more than a week", () => {
    expect(
      attentionReasons({ ...base, overdue: 1, oldest_overdue_due: "2026-09-14" }, "2026-09-26"),
    ).toEqual(["1 task overdue, oldest 12 days"]);
  });

  it("lists every reason that applies, as facts", () => {
    expect(
      attentionReasons(
        { ...base, blocked_stale: 1, in_progress_stale: 2, overdue_decisions: 1 },
        "2026-09-26",
        1,
      ),
    ).toEqual([
      "1 blocked task with no update for 5+ days",
      "2 tasks in progress with no update for 7+ days",
      "1 project report overdue",
      "1 decision past due",
    ]);
  });
});

describe("sortForAttention", () => {
  it("puts people with more reasons first, then more overdue, then by name", () => {
    const entries = [
      { row: { ...base, full_name: "Zoe" }, reasons: [] },
      { row: { ...base, full_name: "Ana", overdue: 1 }, reasons: ["a"] },
      { row: { ...base, full_name: "Ben", overdue: 5 }, reasons: ["a"] },
      { row: { ...base, full_name: "Cal" }, reasons: ["a", "b"] },
      { row: { ...base, full_name: "Abe" }, reasons: [] },
    ];
    expect(sortForAttention(entries).map((e) => e.row.full_name)).toEqual([
      "Cal", "Ben", "Ana", "Abe", "Zoe",
    ]);
  });
});
