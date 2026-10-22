import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const sent: { user_id: string; title: string; source_id: string }[][] = [];
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: async (_db: unknown, drafts: { user_id: string; title: string; source_id: string }[]) => {
    sent.push(drafts);
    return drafts.length;
  },
  notificationDedupeKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/observability", () => ({ reportError: vi.fn() }));

const { spawnRecurringSuccessor } = await import("../services/recurring-successor");

const ORG = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const LEFT = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const TASK = "55555555-5555-4555-8555-555555555555";
const SERIES = "66666666-6666-4666-8666-666666666666";
const NEXT = "77777777-7777-4777-8777-777777777777";
const actor = { userId: ME, organizationId: ORG, displayName: "QA Owner" };

let source: Record<string, unknown> | null;
let series: Record<string, unknown> | null;
let active: Set<string>;
let insertAnswer: Answer;
let calls: TableCall[];
let membershipError = false;

function db() {
  const fake = fakeDb({
    table: (call) => {
      if (call.table === "task" && call.action === "select") return { data: source, error: null };
      if (call.table === "task" && call.action === "insert") return insertAnswer;
      if (call.table === "task_series") return { data: series, error: null };
      if (call.table === "organization_membership") {
        if (membershipError) return { data: null, error: { message: "timeout" } };
        const user = call.filters.find((f) => f.column === "user_id")?.value as string;
        return { data: active.has(user) ? { user_id: user } : null, error: null };
      }
      return { data: null, error: null };
    },
  });
  calls = fake.tableCalls;
  return fake.db;
}

const inserted = () => calls.find((c) => c.table === "task" && c.action === "insert")?.payload as Record<string, unknown> | undefined;

beforeEach(() => {
  sent.length = 0;
  membershipError = false;
  source = {
    title: "Monthly report",
    description: null,
    project_id: null,
    program_id: null,
    assignee_id: LEFT,
    priority: "medium",
    due_at: "2026-01-31",
    recurrence_rule: "monthly",
    recurrence_anchor: "2026-01-20",
    recurrence_parent_id: null,
    series_id: null,
    series_edited_at: null,
  };
  series = null;
  active = new Set([ME, LEFT, OWNER]);
  insertAnswer = { data: { id: NEXT }, error: null };
});

describe("spawnRecurringSuccessor", () => {
  it("makes nothing for a task that does not repeat", async () => {
    source = { ...source, recurrence_rule: null };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toBeUndefined();
  });

  it("starts a monthly chain on its due date's day and carries that day as the anchor", async () => {
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({
      due_at: "2026-02-28",
      recurrence_anchor: "2026-01-31",
      recurrence_parent_id: TASK,
      assignee_id: LEFT,
      status: "not_started",
    });
    expect(sent).toEqual([]);
  });

  it("brings a later occurrence back to the anchor day after a short month", async () => {
    source = { ...source, due_at: "2026-02-28", recurrence_anchor: "2026-01-31", recurrence_parent_id: "parent" };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ due_at: "2026-03-31", recurrence_anchor: "2026-01-31" });
  });

  it("follows a rescheduled occurrence's new day, and ignores an anchor that is only when the repeat was switched on", async () => {
    source = { ...source, due_at: "2026-03-15", recurrence_anchor: "2026-01-31", recurrence_parent_id: "parent" };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ due_at: "2026-04-15", recurrence_anchor: "2026-03-15" });

    source = { ...source, due_at: "2026-11-15", recurrence_anchor: "2026-10-22", recurrence_parent_id: "parent" };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ due_at: "2026-12-15" });

    // Slipped from 31 January to 1 February: the next is 1 March, as before.
    source = { ...source, due_at: "2026-02-01", recurrence_anchor: "2026-01-31", recurrence_parent_id: "parent" };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ due_at: "2026-03-01" });
  });

  it("keeps the assignee when their membership cannot be read", async () => {
    membershipError = true;
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ assignee_id: LEFT });
    expect(sent).toEqual([]);
  });

  it("makes nothing for a stopped series", async () => {
    source = { ...source, series_id: SERIES };
    series = { stopped_at: "2026-01-01T00:00:00Z", title: "Monthly report", owner_id: OWNER };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toBeUndefined();
  });

  it("gives the next one to the series owner, and tells them, when the assignee is no longer active", async () => {
    source = { ...source, series_id: SERIES };
    series = { stopped_at: null, title: "Monthly report", owner_id: OWNER };
    active.delete(LEFT);
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ assignee_id: OWNER, series_id: SERIES, occurrence_date: "2026-02-28" });
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({ user_id: OWNER, source_id: NEXT });
    expect(sent[0][0].title).toContain("Monthly report");
  });

  it("leaves it unassigned, and tells the person who completed it, when nobody active can take it", async () => {
    active.delete(LEFT);
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(inserted()).toMatchObject({ assignee_id: null, due_at: "2026-02-28" });
    expect(sent[0][0]).toMatchObject({ user_id: ME, source_id: NEXT });
  });

  it("treats a successor that already exists as done, and tells nobody", async () => {
    active.delete(LEFT);
    insertAnswer = { data: null, error: { code: "23505", message: "duplicate key" } };
    await spawnRecurringSuccessor(db(), actor, TASK);
    expect(sent).toEqual([]);
  });
});
