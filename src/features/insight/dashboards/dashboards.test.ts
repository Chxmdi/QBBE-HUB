import { describe, expect, it } from "vitest";
import { niceMax } from "../components/charts";
import { buildDashboard, sourcesFor, templateFor, type DashboardRows } from "./dashboards";

const now = new Date("2026-09-30T15:00:00Z");
const zone = "America/Toronto";

const rows: DashboardRows = {
  programs: [{ id: "p1", name: "Literacy" }],
  projects: [
    { id: "a", program_id: "p1" },
    { id: "b", program_id: null },
    { id: "hidden-programme", program_id: "p-unseen" },
  ],
  tasks: [
    { status: "in_progress", due_at: "2026-09-01", completed_at: null, created_at: "2026-09-02T10:00:00Z", program_id: null, project_id: "a" },
    { status: "not_started", due_at: "2026-12-01", completed_at: null, created_at: "2026-09-29T10:00:00Z", program_id: "p1", project_id: null },
    { status: "completed", due_at: "2026-09-01", completed_at: "2026-09-25T10:00:00Z", created_at: "2026-08-01T10:00:00Z", program_id: null, project_id: "b" },
    { status: "cancelled", due_at: "2026-09-01", completed_at: null, created_at: "2026-08-01T10:00:00Z", program_id: null, project_id: null },
  ],
  risks: [{ status: "open" }, { status: "closed" }, { status: "mitigating" }],
  events: [{ starts_at: "2026-10-05T18:00:00Z", program_id: null, project_id: "a" }],
  activity: [{ created_at: "2026-09-29T10:00:00Z" }, { created_at: "2026-09-29T11:00:00Z" }],
  bills: [
    { total_cents: 10000, paid_cents: 2500, status: "posted" },
    { total_cents: 5000, paid_cents: 0, status: "draft" },
  ],
  invoices: [{ total_cents: 3000, paid_cents: 3000, status: "posted" }],
  gifts: [
    { amount_cents: 50000, received_on: "2026-09-29", status: "recorded" },
    { amount_cents: 20000, received_on: "2025-12-31", status: "recorded" },
    { amount_cents: 99900, received_on: "2026-09-29", status: "voided" },
  ],
  measurements: [{ measured_on: "2026-09-01" }, { measured_on: "2026-05-01" }],
};

describe("templates", () => {
  it("falls back to the executive dashboard for an unknown key", () => {
    expect(templateFor("nonsense").key).toBe("executive");
    expect(templateFor("finance").key).toBe("finance");
  });
  it("loads only what a template shows", () => {
    expect([...sourcesFor(templateFor("finance"))].sort()).toEqual(["bills", "gifts", "invoices"]);
    expect(sourcesFor(templateFor("executive")).has("bills")).toBe(false);
  });
});

describe("buildDashboard", () => {
  it("computes the executive figures", () => {
    const data = buildDashboard(templateFor("executive"), rows, now, zone);
    expect(data.stats).toEqual({
      openTasks: { kind: "count", value: 2 },
      overdueTasks: { kind: "count", value: 1 },
      completedLast30: { kind: "count", value: 1 },
      activeProjects: { kind: "count", value: 3 },
      openRisks: { kind: "count", value: 2 },
      upcomingEvents: { kind: "count", value: 1 },
    });
    expect(data.trends.activity!.at(-1)).toEqual({ start: "2026-09-28", count: 2 });
    expect(data.trends.tasksCompleted!.at(-2)).toEqual({ start: "2026-09-21", count: 1 });
  });

  it("counts only posted balances and this year's recorded gifts for finance", () => {
    const data = buildDashboard(templateFor("finance"), rows, now, zone);
    expect(data.stats.billsOutstanding).toEqual({ kind: "money", cents: 7500 });
    expect(data.stats.invoicesOutstanding).toEqual({ kind: "money", cents: 0 });
    expect(data.stats.giftsThisYear).toEqual({ kind: "money", cents: 50000 });
    expect(data.trends.giftsReceived!.at(-1)!.count).toBe(500);
    expect(data.spaceTotals).toEqual([]);
  });

  it("totals by programme, putting unreadable programmes under No programme", () => {
    const data = buildDashboard(templateFor("programs"), rows, now, zone);
    expect(data.stats.measurementsLast90).toEqual({ kind: "count", value: 1 });
    expect(data.spaceTotals).toEqual([
      { programId: "p1", name: "Literacy", projects: 1, openTasks: 2, overdueTasks: 1, completedLast30: 0, upcomingEvents: 1 },
      { programId: null, name: null, projects: 2, openTasks: 0, overdueTasks: 0, completedLast30: 1, upcomingEvents: 0 },
    ]);
  });
});

describe("niceMax", () => {
  it("rounds an axis top to 1, 2, 5 or 10 times a power of ten", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(480)).toBe(500);
  });
});
