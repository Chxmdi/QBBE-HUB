import { describe, expect, it } from "vitest";
import {
  approvalWaits,
  bottleneck,
  median,
  statusChangesFromMetadata,
  statusIntervals,
  timeInStatus,
  turnaround,
  type TaskHistory,
} from "./process";

const now = new Date("2026-09-30T00:00:00Z");
const day = (d: number) => new Date(Date.UTC(2026, 8, d)).toISOString(); // September d

// Created on the 1st, ready on the 3rd, waiting on the 5th, in progress on the 15th, still open.
const slow: TaskHistory = {
  id: "slow",
  createdAt: day(1),
  currentStatus: "in_progress",
  changes: [
    { at: day(15), from: "waiting", to: "in_progress" },
    { at: day(3), from: "not_started", to: "ready" },
    { at: day(5), from: "ready", to: "waiting" },
  ],
};
// Created on the 10th, waiting on the 12th, completed on the 14th.
const done: TaskHistory = {
  id: "done",
  createdAt: day(10),
  currentStatus: "completed",
  changes: [
    { at: day(12), from: "not_started", to: "waiting" },
    { at: day(14), from: "waiting", to: "completed" },
  ],
};
// Never moved.
const idle: TaskHistory = { id: "idle", createdAt: day(20), currentStatus: "not_started", changes: [] };

describe("statusIntervals", () => {
  it("rebuilds the stretches in order, ending open in the current status", () => {
    const hours = statusIntervals(slow, now).map((i) => [i.status, (i.end - i.start) / 3_600_000, i.open]);
    expect(hours).toEqual([
      ["not_started", 48, false],
      ["ready", 48, false],
      ["waiting", 240, false],
      ["in_progress", 360, true],
    ]);
  });
  it("counts no time in a terminal status", () => {
    expect(statusIntervals(done, now).map((i) => i.status)).toEqual(["not_started", "waiting"]);
  });
  it("starts no earlier than the window", () => {
    const [first] = statusIntervals(slow, now, new Date(day(2)));
    expect(first.start).toBe(new Date(day(2)).getTime());
  });
});

describe("timeInStatus and bottleneck", () => {
  it("ranks statuses by average stretch and counts who is there now", () => {
    const stats = timeInStatus([slow, done, idle], now);
    const waiting = stats.find((s) => s.status === "waiting")!;
    expect(waiting).toMatchObject({ visits: 2, averageHours: 144, medianHours: 144, current: 0 });
    const notStarted = stats.find((s) => s.status === "not_started")!;
    expect(notStarted).toMatchObject({ visits: 3, current: 1, longestCurrentHours: 240 });
    expect(stats[0].status).toBe("in_progress");
    // in_progress has one visit only; the bottleneck needs two.
    expect(bottleneck(stats)!.status).toBe("waiting");
    expect(bottleneck([])).toBeNull();
  });
});

describe("turnaround", () => {
  it("averages finished items per type and counts the open ones", () => {
    const result = turnaround(
      [
        { type: "task", start: day(1), end: day(3) },
        { type: "task", start: day(1), end: day(5) },
        { type: "task", start: day(1), end: null },
        { type: "risk", start: day(1), end: null },
      ],
      ["task", "risk", "approval"],
    );
    expect(result).toEqual([
      { type: "task", finished: 2, averageHours: 72, medianHours: 72, open: 1 },
      { type: "risk", finished: 0, averageHours: null, medianHours: null, open: 1 },
      { type: "approval", finished: 0, averageHours: null, medianHours: null, open: 0 },
    ]);
  });
});

describe("approvalWaits", () => {
  it("measures each decision from the submission or previous step, and pending items to now", () => {
    const result = approvalWaits(
      [
        { id: "a", title: "Budget", status: "approved", createdAt: day(1) },
        { id: "b", title: "Contract", status: "pending", createdAt: day(20) },
      ],
      [
        { itemId: "a", kind: "submitted", step: null, at: day(1) },
        { itemId: "a", kind: "commented", step: 1, at: day(2) },
        { itemId: "a", kind: "approved", step: 1, at: day(3) },
        { itemId: "a", kind: "approved", step: 2, at: day(7) },
        { itemId: "b", kind: "submitted", step: null, at: day(20) },
        { itemId: "b", kind: "approved", step: 1, at: day(22) },
      ],
      now,
    );
    expect(result.decisions).toBe(3);
    expect(result.averageHours).toBe(64);
    expect(result.byStep).toEqual([
      { step: 1, decisions: 2, averageHours: 48 },
      { step: 2, decisions: 1, averageHours: 96 },
    ]);
    expect(result.waiting).toEqual([{ id: "b", title: "Contract", hours: 192 }]);
  });
});

describe("helpers", () => {
  it("finds the median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("reads status changes out of activity metadata and ignores the rest", () => {
    expect(
      statusChangesFromMetadata(
        { changes: [{ field: "status", from: "ready", to: "blocked" }, { field: "due_at", from: null, to: "2026-10-01" }] },
        day(4),
      ),
    ).toEqual([{ at: day(4), from: "ready", to: "blocked" }]);
    expect(statusChangesFromMetadata({ role: "reviewer" }, day(4))).toEqual([]);
    expect(statusChangesFromMetadata(null, day(4))).toEqual([]);
  });
});
