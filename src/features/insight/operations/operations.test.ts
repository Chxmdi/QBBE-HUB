import { describe, expect, it } from "vitest";
import { goalTrajectory, openLoadByWeek, overduePatterns, workloadByPerson, type GoalMetric, type OpsTask } from "./operations";

const now = new Date("2026-09-30T15:00:00Z"); // Wednesday
const zone = "America/Toronto";
const task = (over: Partial<OpsTask>): OpsTask => ({
  assigneeId: "ana",
  projectId: "p",
  status: "in_progress",
  priority: "medium",
  createdAt: "2026-08-01T12:00:00Z",
  dueAt: null,
  completedAt: null,
  ...over,
});

describe("openLoadByWeek", () => {
  it("counts tasks open at each week's end", () => {
    const tasks = [
      task({}),
      task({ createdAt: "2026-09-29T12:00:00Z" }), // this week only
      task({ status: "completed", completedAt: "2026-09-23T12:00:00Z" }), // open until the week of Sep 21
      task({ status: "cancelled" }), // open in past weeks, not now
    ];
    const weeks = openLoadByWeek(tasks, now, zone, 3);
    expect(weeks).toEqual([
      { start: "2026-09-14", count: 3 },
      { start: "2026-09-21", count: 2 },
      { start: "2026-09-28", count: 2 },
    ]);
  });
});

describe("workloadByPerson", () => {
  it("summarises each person's open, overdue and recent work", () => {
    const loads = workloadByPerson(
      [
        task({ dueAt: "2026-09-20" }),
        task({ dueAt: "2026-10-20" }),
        task({ status: "completed", completedAt: "2026-09-25T12:00:00Z" }),
        task({ assigneeId: "ben", status: "completed", completedAt: "2026-06-01T12:00:00Z" }),
        task({ assigneeId: null }),
      ],
      now,
      zone,
    );
    expect(loads.map((l) => [l.personId, l.open, l.overdue, l.finishedLast28])).toEqual([["ana", 2, 1, 1]]);
  });
});

describe("overduePatterns", () => {
  it("groups overdue work by lateness, priority and project, and counts late finishes and slips", () => {
    const result = overduePatterns(
      [
        task({ dueAt: "2026-09-27", priority: "high" }), // 3 days late
        task({ dueAt: "2026-09-10", priority: "high", projectId: "q" }), // 20 days
        task({ dueAt: "2026-07-01", priority: "low", projectId: "q" }), // 91 days
        task({ dueAt: "2026-09-15", status: "completed", completedAt: "2026-09-18T12:00:00Z" }), // finished late
        task({ dueAt: "2026-09-15", status: "completed", completedAt: "2026-09-14T12:00:00Z" }), // on time
        task({ dueAt: "2026-10-10" }), // not due yet
      ],
      now,
      zone,
    );
    expect(result.total).toBe(3);
    expect(result.byLateness).toEqual({ days1to7: 1, days8to30: 1, days31plus: 1 });
    expect(result.byPriority).toEqual([{ priority: "high", count: 2 }, { priority: "low", count: 1 }]);
    expect(result.byProject[0]).toEqual({ projectId: "q", count: 2 });
    expect([result.finished, result.finishedLate]).toEqual([2, 1]);
    // The week of Sep 14 had one slip (due 15th, finished 18th) — the on-time one does not count.
    expect(result.slippedByWeek.find((w) => w.start === "2026-09-14")!.count).toBe(1);
    expect(result.slippedByWeek.find((w) => w.start === "2026-09-07")!.count).toBe(1);
  });
});

describe("goalTrajectory", () => {
  const metric: GoalMetric = {
    id: "m", name: "Students tutored", unit: "people", direction: "increase",
    baseline: 0, baselineOn: "2026-01-01", target: 100, targetOn: "2026-12-31",
  };
  const at = (measuredOn: string, value: number) => ({ metricId: "m", measuredOn, value });

  it("compares the latest value with the straight line to the target", () => {
    // July 2 is about half way: 50 expected.
    expect(goalTrajectory(metric, [at("2026-07-02", 50)]).status).toBe("on_track");
    expect(goalTrajectory(metric, [at("2026-07-02", 30)]).status).toBe("behind");
    expect(goalTrajectory(metric, [at("2026-07-02", 70)]).status).toBe("ahead");
    expect(goalTrajectory(metric, [at("2026-07-02", 100)]).status).toBe("reached");
  });
  it("works the other way for a decreasing goal", () => {
    const down = { ...metric, direction: "decrease" as const, baseline: 100, target: 0 };
    expect(goalTrajectory(down, [at("2026-07-02", 30)]).status).toBe("ahead");
    expect(goalTrajectory(down, [at("2026-07-02", 70)]).status).toBe("behind");
  });
  it("projects the recent pace to the target date", () => {
    const result = goalTrajectory(metric, [at("2026-03-01", 10), at("2026-05-01", 20), at("2026-07-01", 30)]);
    expect(result.projected).toBeGreaterThan(55);
    expect(result.projected).toBeLessThan(65);
    expect(result.points.map((p) => p.value)).toEqual([10, 20, 30]);
  });
  it("says when there is nothing to compare", () => {
    expect(goalTrajectory(metric, []).status).toBe("no_data");
    expect(goalTrajectory({ ...metric, target: null }, [at("2026-07-02", 5)]).status).toBe("no_target");
  });
});
