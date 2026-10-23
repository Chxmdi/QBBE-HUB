import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type TableCall } from "@/lib/objects/testing/fake-db";

// Both ways a task is completed make the next occurrence, and a new series'
// first task goes through the one "create task" path (notice and activity).

const ORG = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const OWNER = "44444444-4444-4444-8444-444444444444";
const A = "55555555-5555-4555-8555-555555555551";
const B = "55555555-5555-4555-8555-555555555552";
const SERIES = "66666666-6666-4666-8666-666666666666";

const spawned: string[] = [];
const notices: { user_id: string; category: string }[] = [];
let calls: TableCall[] = [];
let priorStatus: Record<string, string> = {};

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({
    userId: ME,
    organizationId: ORG,
    profile: { full_name: "QA Owner" },
    timeZone: "America/Toronto",
    isAdmin: true,
    isStaff: true,
  }),
}));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (key: string) => key, getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null, grantWriteAllowance: async () => true }));
vi.mock("@/features/tasks/services/recurring-successor", () => ({
  spawnRecurringSuccessor: async (_db: unknown, _actor: unknown, taskId: string) => {
    spawned.push(taskId);
  },
}));
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: async (_db: unknown, drafts: { user_id: string; category: string }[]) => {
    notices.push(...drafts);
    return drafts.length;
  },
  notificationDedupeKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({
      table: (call) => {
        if (call.table === "task" && call.action === "select" && call.filters.some((f) => f.op === "in")) {
          return { data: [A, B].map((id) => ({ id, status: priorStatus[id] })), error: null };
        }
        if (call.table === "task" && call.action === "update") {
          return { data: [A, B].map((id) => ({ id, title: id, project_id: null, program_id: null })), error: null };
        }
        if (call.table === "task_series") return { data: { id: SERIES }, error: null };
        if (call.table === "task" && call.action === "insert") return { data: { id: "77777777-7777-4777-8777-777777777777" }, error: null };
        return { data: null, error: null };
      },
    });
    calls = fake.tableCalls;
    return fake.db;
  },
}));

const { bulkUpdateTasks } = await import("../services/task.commands");
const { createTaskSeries } = await import("../services/planning.commands");

beforeEach(() => {
  spawned.length = 0;
  notices.length = 0;
  priorStatus = { [A]: "in_progress", [B]: "completed" };
});

describe("completing from the bulk bar", () => {
  it("makes the next occurrence of each task it newly completes", async () => {
    expect(await bulkUpdateTasks({ taskIds: [A, B], action: "status", status: "completed" })).toMatchObject({ ok: true });
    expect(spawned).toEqual([A]);
  });

  it("makes none for other bulk changes", async () => {
    await bulkUpdateTasks({ taskIds: [A, B], action: "status", status: "in_progress" });
    await bulkUpdateTasks({ taskIds: [A, B], action: "priority", priority: "high" });
    expect(spawned).toEqual([]);
  });
});

describe("createTaskSeries", () => {
  it("creates the first task through the shared path: the owner is told and the activity is written", async () => {
    const result = await createTaskSeries({ title: "Monthly report", recurrenceRule: "monthly", ownerId: OWNER, startsOn: "2026-01-31" });
    expect(result).toMatchObject({ ok: true, id: SERIES });
    const task = calls.find((c) => c.table === "task" && c.action === "insert");
    expect(task?.payload).toMatchObject({
      assignee_id: OWNER,
      due_at: "2026-01-31",
      source_type: "recurrence",
      source_id: SERIES,
      series_id: SERIES,
      recurrence_rule: "monthly",
      recurrence_anchor: "2026-01-31",
    });
    expect(calls.some((c) => c.table === "activity_event" && c.action === "insert")).toBe(true);
    expect(notices).toEqual([expect.objectContaining({ user_id: OWNER, category: "assignment" })]);
  });
});
