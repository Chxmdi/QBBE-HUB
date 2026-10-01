import { describe, expect, it, vi } from "vitest";
import { fakeDb, changeSetRow, type RpcCall, type TableCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const PROJECT = "77777777-7777-4777-8777-777777777777";
const MEETING = "66666666-6666-4666-8666-666666666666";
const CAPTURE = "22222222-2222-4222-8222-222222222222";
const TASK = "11111111-1111-4111-8111-111111111111";

let rpcCalls: RpcCall[] = [];
let tableCalls: TableCall[] = [];
const createUniversalTask = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ userId: ME, organizationId: ORG, profile: { full_name: "QA Owner" } }),
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("../flag", () => ({ meetingsV2Enabled: async () => true }));
vi.mock("@/features/universal-tasks/create-task", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createUniversalTask: (...args: unknown[]) => createUniversalTask(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({
      table: (call) => {
        if (call.table === "meeting") return { data: { id: MEETING, organization_id: ORG, project_id: PROJECT, program_id: null }, error: null };
        if (call.table === "meeting_capture" && call.action === "select") {
          return { data: [{ id: CAPTURE, kind: "task", body: "Book the hall", detail: null, status: "open", owner_id: null, due_on: null }], error: null };
        }
        return { data: null, error: null };
      },
      rpc: ({ fn }) => {
        if (fn === "can_manage_meeting") return { data: true, error: null };
        if (fn === "can") return { data: true, error: null };
        if (fn === "object_event_high_water") return { data: 2, error: null };
        if (fn === "record_change_set") return { data: changeSetRow("cs-5", { actor_kind: "person", actor_id: ME }), error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    });
    rpcCalls = fake.rpcCalls;
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { applyMeetingReview } = await import("../services/meeting-v2.commands");

describe("applyMeetingReview", () => {
  it("creates the task through the registry and records the creation as a change set", async () => {
    createUniversalTask.mockResolvedValue({ ok: true, id: TASK, projectId: PROJECT, programId: null });
    const result = await applyMeetingReview({ meetingId: MEETING, choices: { [CAPTURE]: "approve" } });
    expect(result.ok).toBe(true);
    // The task's project is checked with the real access check.
    expect(rpcCalls.find((c) => c.fn === "can")?.args).toEqual({ object_id: PROJECT, capability: "edit_content" });
    expect(rpcCalls.find((c) => c.fn === "record_change_set")?.args).toEqual({
      p_action_key: "task.create",
      p_changes: [{
        kind: "create",
        object: { id: TASK, type: "task" },
        values: { title: "Book the hall", project: PROJECT, source: { type: "meeting", id: MEETING } },
      }],
      p_since_seq: 2,
      p_undo_of: null,
    });
    const link = tableCalls.find((c) => c.table === "meeting_action" && c.action === "insert");
    expect(link?.payload).toMatchObject({ meeting_id: MEETING, task_id: TASK });
    const reviewed = tableCalls.find((c) => c.table === "meeting_capture" && c.action === "update");
    expect(reviewed?.payload).toEqual({ status: "approved", created_object_type: "task", created_object_id: TASK });
  });

  it("counts a capture whose task could not be made and records no change set", async () => {
    createUniversalTask.mockResolvedValue({ ok: false, reason: "failed" });
    const result = await applyMeetingReview({ meetingId: MEETING, choices: { [CAPTURE]: "approve" } });
    expect(result.ok).toBe(false);
    expect(rpcCalls.map((c) => c.fn)).not.toContain("record_change_set");
  });
});
