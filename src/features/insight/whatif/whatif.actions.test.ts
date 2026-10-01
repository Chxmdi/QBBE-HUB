import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, changeSetRow, type RpcCall, type TableCall } from "@/lib/objects/testing/fake-db";
import { planFingerprint, planShift, type Schedule } from "./whatif";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const PROJECT = "77777777-7777-4777-8777-777777777777";
const MILESTONE = "88888888-8888-4888-8888-888888888888";
const TASK = "11111111-1111-4111-8111-111111111111";

const schedule: Schedule = {
  milestones: [{ id: MILESTONE, name: "Print", projectId: PROJECT, due: "2026-10-10" }],
  tasks: [{ id: TASK, title: "Proof", projectId: PROJECT, milestoneId: MILESTONE, start: null, due: "2026-10-08", closed: false }],
  projects: [{ id: PROJECT, name: "Gala", programId: null, targetDate: null }],
  goals: [],
  milestoneDeps: [],
  taskDeps: [],
};

class Redirected extends Error {
  constructor(public readonly url: string) {
    super(`redirect ${url}`);
  }
}

let rpcCalls: RpcCall[] = [];
let tableCalls: TableCall[] = [];
let canAnswer = true;

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirected(url); } }));
vi.mock("@/lib/feature-flags", () => ({ isEnabled: async () => true }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME, organizationId: ORG }) }));
vi.mock("./whatif.source", () => ({ loadSchedule: async () => ({ schedule }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({
      table: () => ({ data: null, error: null }),
      rpc: ({ fn }) => {
        if (fn === "can") return { data: canAnswer, error: null };
        if (fn === "insight_apply_schedule_shift") return { data: 2, error: null };
        if (fn === "object_event_high_water") return { data: 5, error: null };
        if (fn === "record_change_set") return { data: changeSetRow("cs-7", { actor_kind: "person", actor_id: ME }), error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    });
    rpcCalls = fake.rpcCalls;
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { applyMilestoneShift } = await import("./whatif.actions");

function form(days: number, fingerprint: string) {
  const data = new FormData();
  data.set("milestone", MILESTONE);
  data.set("days", String(days));
  data.set("fingerprint", fingerprint);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Redirected) return error.url;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("applyMilestoneShift", () => {
  beforeEach(() => {
    canAnswer = true;
  });

  it("applies the shift through the registry and records the change set anchored to the organization", async () => {
    const plan = planShift(schedule, MILESTONE, 3)!;
    const url = await redirectOf(applyMilestoneShift(form(3, planFingerprint(plan))));
    expect(url).toContain("result=applied");
    expect(url).toContain("moved=2");

    // Every project and task was checked with the real access check.
    expect(rpcCalls.filter((c) => c.fn === "can").map((c) => c.args)).toEqual([
      { object_id: PROJECT, capability: "edit_structure" },
      { object_id: TASK, capability: "edit_structure" },
    ]);
    // Milestones are not objects, so the change set names the organization.
    const recorded = rpcCalls.find((c) => c.fn === "record_change_set");
    expect(recorded?.args).toEqual({
      p_action_key: "insight.shift_milestone",
      p_changes: [
        { kind: "update", object: { id: MILESTONE, type: "milestone" }, property: "due", before: "2026-10-10", after: "2026-10-13" },
        { kind: "update", object: { id: TASK, type: "task" }, property: "due", before: "2026-10-08", after: "2026-10-11" },
      ],
      p_since_seq: 5,
      p_undo_of: null,
      p_organization: ORG,
    });
    // The project activity page still reads the old feed.
    const feed = tableCalls.filter((c) => c.table === "activity_event" && c.action === "insert");
    expect(feed.map((c) => (c.payload as { source_id: string; metadata: { change_set_id: string } }))).toMatchObject([
      { source_id: MILESTONE, metadata: { change_set_id: "cs-7" } },
      { source_id: TASK, metadata: { change_set_id: "cs-7" } },
    ]);
  });

  it("refuses when the person may not change the schedule, and writes nothing", async () => {
    canAnswer = false;
    const plan = planShift(schedule, MILESTONE, 3)!;
    const url = await redirectOf(applyMilestoneShift(form(3, planFingerprint(plan))));
    expect(url).toContain("result=forbidden");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("insight_apply_schedule_shift");
    expect(rpcCalls.map((c) => c.fn)).not.toContain("record_change_set");
  });

  it("stops when the preview is stale", async () => {
    const url = await redirectOf(applyMilestoneShift(form(3, "not-the-fingerprint")));
    expect(url).toContain("result=stale");
  });
});
