import { describe, expect, it } from "vitest";
import {
  applyPortfolioFilters,
  dashboardLens,
  isOverloaded,
  parsePortfolioFilters,
  portfolioCounts,
  rollupWorkloadByTeam,
  summarizeWorkload,
  type PortfolioSource,
} from "@/features/dashboard/portfolio";

function row(overrides: Partial<PortfolioSource> = {}): PortfolioSource {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Saturday club",
    programId: "22222222-2222-2222-2222-222222222222",
    programName: "Youth",
    ownerId: "33333333-3333-3333-3333-333333333333",
    ownerName: "QA Owner",
    health: "on_track",
    stage: "active",
    priority: "medium",
    targetDate: "2026-10-01",
    progressPercent: 50,
    nextMilestone: "Open registration",
    nextMilestoneDue: "2026-09-30",
    mainBlocker: null,
    lastUpdateAt: "2026-09-20T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    reportingCadence: "weekly",
    stale: false,
    archivedAt: null,
    fundingSourceId: null,
    ...overrides,
  };
}

describe("portfolio filters", () => {
  it("drops an invalid parameter instead of applying it", () => {
    expect(parsePortfolioFilters({ health: "fine", stage: "active" })).toEqual({});
    expect(parsePortfolioFilters({ stage: "active", stale: "1" }).stage).toBe("active");
  });

  it("filters by owner, health, date range, and team membership", () => {
    const rows = [
      row(),
      row({
        id: "44444444-4444-4444-4444-444444444444",
        health: "at_risk",
        ownerId: "55555555-5555-5555-5555-555555555555",
        targetDate: "2026-12-01",
      }),
    ];
    expect(applyPortfolioFilters(rows, { health: "at_risk" }, new Set()).map((item) => item.id)).toEqual([
      "44444444-4444-4444-4444-444444444444",
    ]);
    expect(
      applyPortfolioFilters(rows, { from: "2026-11-01" }, new Set()),
    ).toHaveLength(1);
    expect(
      applyPortfolioFilters(
        rows,
        { member: "33333333-3333-3333-3333-333333333333" },
        new Set(["11111111-1111-1111-1111-111111111111"]),
      ),
    ).toHaveLength(1);
  });

  it("counts active, health, paused, and stale separately from progress", () => {
    const counts = portfolioCounts([
      row(),
      row({ id: "a", health: "at_risk", stale: true }),
      row({ id: "b", health: "off_track" }),
      row({ id: "c", stage: "paused", health: "paused" }),
      row({ id: "d", stage: "completed", health: "on_track" }),
    ]);
    expect(counts).toEqual({ active: 3, onTrack: 1, atRisk: 1, offTrack: 1, paused: 1, stale: 1 });
  });
});

describe("dashboard lens", () => {
  it("keeps volunteers off the portfolio and leadership on it", () => {
    expect(dashboardLens("owner")).toBe("leadership");
    expect(dashboardLens("leadership_viewer")).toBe("leadership");
    expect(dashboardLens("staff")).toBe("staff");
    expect(dashboardLens("volunteer")).toBe("volunteer");
  });
});

describe("summarizeWorkload", () => {
  it("sums estimates and leaves an all-unknown load unknown", () => {
    const people = summarizeWorkload(
      [
        { assigneeId: "p", assigneeName: "Pat", dueAt: "2026-09-01", estimateHours: 2 },
        { assigneeId: "p", assigneeName: "Pat", dueAt: "2026-09-25", estimateHours: null },
        { assigneeId: "q", assigneeName: "Quinn", dueAt: "2026-09-20", estimateHours: null },
      ],
      "2026-09-23",
      "2026-09-30",
    );
    expect(people[0]).toMatchObject({
      name: "Pat",
      active: 2,
      overdue: 1,
      dueSoon: 1,
      estimatedHours: 2,
      unknownEstimates: 1,
    });
    expect(people[1].estimatedHours).toBeNull();
    expect(people[0].overloaded).toBe(false);
  });

  it("flags overload at three overdue tasks or more than 40 near-term hours", () => {
    expect(isOverloaded({ overdue: 3, nearTermHours: null })).toBe(true);
    expect(isOverloaded({ overdue: 0, nearTermHours: 41 })).toBe(true);
    expect(isOverloaded({ overdue: 2, nearTermHours: 40 })).toBe(false);
    const people = summarizeWorkload(
      [
        { assigneeId: "p", assigneeName: "Pat", dueAt: "2026-09-24", estimateHours: 41 },
        { assigneeId: "q", assigneeName: "Quinn", dueAt: "2026-09-01", estimateHours: 1 },
        { assigneeId: "q", assigneeName: "Quinn", dueAt: "2026-09-02", estimateHours: 1 },
        { assigneeId: "q", assigneeName: "Quinn", dueAt: "2026-09-03", estimateHours: 1 },
      ],
      "2026-09-23",
      "2026-09-30",
    );
    expect(people.find((person) => person.name === "Pat")?.overloaded).toBe(true);
    expect(people.find((person) => person.name === "Quinn")?.overloaded).toBe(true);
  });

  it("rolls person load up by team", () => {
    const people = summarizeWorkload(
      [{ assigneeId: "p", assigneeName: "Pat", dueAt: "2026-09-24", estimateHours: 4 }],
      "2026-09-23",
      "2026-09-30",
    );
    expect(
      rollupWorkloadByTeam(people, [{ teamId: "t", teamName: "Delivery", userId: "p" }]),
    ).toMatchObject([{ name: "Delivery", active: 1, dueSoon: 1 }]);
  });
});

describe("funding filter", () => {
  it("keeps only projects with the chosen funder", () => {
    const funder = "66666666-6666-6666-6666-666666666666";
    const rows = [row(), row({ id: "funded", fundingSourceId: funder })];
    expect(applyPortfolioFilters(rows, { funding: funder }, new Set()).map((item) => item.id)).toEqual([
      "funded",
    ]);
  });
});
