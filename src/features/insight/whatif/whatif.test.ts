import { describe, expect, it } from "vitest";
import { clampDays, daysBetween, planFingerprint, planShift, type Schedule } from "./whatif";

// Venue (M1, Oct 1) blocks Invitations (M2, Oct 5) which blocks Event day
// (M3, Oct 20). Task T1 is in M1; T2 is in M2; T3 (no milestone) is blocked
// by T1. Project P ends with its latest date; goal G targets Oct 25.
const schedule: Schedule = {
  milestones: [
    { id: "m1", name: "Venue", projectId: "p", due: "2026-10-01" },
    { id: "m2", name: "Invitations", projectId: "p", due: "2026-10-05" },
    { id: "m3", name: "Event day", projectId: "p", due: "2026-10-20" },
    { id: "other", name: "Unrelated", projectId: "q", due: "2026-10-02" },
  ],
  tasks: [
    { id: "t1", title: "Book hall", projectId: "p", milestoneId: "m1", start: "2026-09-25", due: "2026-09-30", closed: false },
    { id: "t2", title: "Print cards", projectId: "p", milestoneId: "m2", start: null, due: "2026-10-04", closed: false },
    { id: "t3", title: "Floor plan", projectId: "p", milestoneId: null, start: null, due: "2026-10-02", closed: false },
    { id: "done", title: "Old task", projectId: "p", milestoneId: "m1", start: null, due: "2026-09-20", closed: true },
  ],
  projects: [
    { id: "p", name: "Gala", programId: "prog", targetDate: "2026-10-22" },
    { id: "q", name: "Other", programId: null, targetDate: null },
  ],
  goals: [
    { id: "g", name: "Raise $50k", programId: "prog", targetOn: "2026-10-25" },
    { id: "g2", name: "Later goal", programId: "prog", targetOn: "2026-12-31" },
  ],
  milestoneDeps: [
    { blocking: "m1", blocked: "m2" },
    { blocking: "m2", blocked: "m3" },
  ],
  taskDeps: [{ blocking: "t1", blocked: "t3" }],
};

describe("helpers", () => {
  it("clamps the shift and counts days", () => {
    expect(clampDays("7")).toBe(7);
    expect(clampDays("x")).toBe(0);
    expect(clampDays(9999)).toBe(365);
    expect(daysBetween("2026-10-01", "2026-10-05")).toBe(4);
  });
});

describe("planShift", () => {
  it("returns nothing for an unknown or undated milestone", () => {
    expect(planShift(schedule, "nope", 3)).toBeNull();
    expect(planShift({ ...schedule, milestones: [{ id: "x", name: "x", projectId: "p", due: null }] }, "x", 3)).toBeNull();
  });

  it("moves a milestone's open tasks with it and uses up slack before pushing dependents", () => {
    // +3: Venue to Oct 4. Invitations (Oct 5) is still after it: slack absorbs it.
    const plan = planShift(schedule, "m1", 3)!;
    expect(plan.milestones.map((m) => [m.id, m.to, m.reason])).toEqual([["m1", "2026-10-04", "shifted"]]);
    expect(plan.tasks.map((t) => [t.id, t.from, t.to, t.reason])).toEqual([
      ["t1", "2026-09-30", "2026-10-03", "in_milestone"],
      ["t3", "2026-10-02", "2026-10-04", "blocked_by"],
    ]);
    // The task's start moves with its due date; the closed task never moves.
    expect(plan.tasks[0]).toMatchObject({ startFrom: "2026-09-25", startTo: "2026-09-28" });
    expect(plan.tasks.some((t) => t.id === "done")).toBe(false);
    expect(plan.projects).toEqual([]);
  });

  it("pushes blocked milestones only as far as they must go, with their tasks, and flags projects and goals", () => {
    // +20: Venue to Oct 21; Invitations must be after: Oct 22 (+17); Event day
    // must be after that: Oct 23 (+3).
    const plan = planShift(schedule, "m1", 20)!;
    expect(plan.milestones.map((m) => [m.id, m.from, m.to, m.reason, m.cause])).toEqual([
      ["m1", "2026-10-01", "2026-10-21", "shifted", null],
      ["m2", "2026-10-05", "2026-10-22", "blocked_by", "m1"],
      ["m3", "2026-10-20", "2026-10-23", "blocked_by", "m2"],
    ]);
    expect(plan.tasks.find((t) => t.id === "t2")).toMatchObject({ from: "2026-10-04", to: "2026-10-21", reason: "in_milestone" });
    expect(plan.projects).toEqual([
      { id: "p", name: "Gala", from: "2026-10-20", to: "2026-10-23", pastTarget: "2026-10-22" },
    ]);
    // The event now ends Oct 23: before Oct 25, so the goal is still fine.
    expect(plan.goals).toEqual([]);
    const longer = planShift(schedule, "m1", 30)!;
    expect(longer.goals.map((g) => [g.id, g.projectFinish])).toEqual([["g", "2026-11-02"]]);
  });

  it("never pulls dependents earlier", () => {
    const plan = planShift(schedule, "m2", -10)!;
    expect(plan.milestones.map((m) => [m.id, m.to])).toEqual([["m2", "2026-09-25"]]);
    expect(plan.tasks.map((t) => [t.id, t.to])).toEqual([["t2", "2026-09-24"]]);
  });

  it("gives the same fingerprint for the same writes and a different one otherwise", () => {
    expect(planFingerprint(planShift(schedule, "m1", 20)!)).toBe(planFingerprint(planShift(schedule, "m1", 20)!));
    expect(planFingerprint(planShift(schedule, "m1", 20)!)).not.toBe(planFingerprint(planShift(schedule, "m1", 21)!));
  });
});
