import { describe, expect, it, vi } from "vitest";
import { fakeDb, changeSetRow, type RpcCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const DECISION = "99999999-9999-4999-8999-999999999999";

let rpcCalls: RpcCall[] = [];
let approvalAnswer: { data: unknown; error: { message: string } | null } = { data: "item-1", error: null };

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({ requireSession: async () => ({ userId: ME, organizationId: ORG }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("../flag", () => ({ objectApprovalsEnabled: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({
      rpc: ({ fn }) => {
        if (fn === "request_object_approval") return approvalAnswer;
        if (fn === "object_event_high_water") return { data: 9, error: null };
        if (fn === "record_change_set") return { data: changeSetRow("cs-2", { actor_kind: "person", actor_id: ME }), error: null };
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      },
    });
    rpcCalls = fake.rpcCalls;
    return fake.db;
  },
}));

const { requestObjectApproval } = await import("../services/object-approval.commands");

describe("requestObjectApproval", () => {
  it("asks the engine and records the request as a change set", async () => {
    approvalAnswer = { data: "item-1", error: null };
    const result = await requestObjectApproval({ type: "decision", id: DECISION, title: "Print locally" });
    expect(result).toEqual({ ok: true, id: "item-1" });
    expect(rpcCalls.find((c) => c.fn === "request_object_approval")?.args).toEqual({
      p_object_type: "decision",
      p_object_id: DECISION,
      p_title: "Print locally",
      p_note: null,
    });
    expect(rpcCalls.find((c) => c.fn === "record_change_set")?.args).toEqual({
      p_action_key: "object.request_approval",
      p_changes: [
        { kind: "create", object: { type: "approval_item", id: "item-1" }, values: { subject: { type: "decision", id: DECISION }, title: "Print locally" } },
        { kind: "link", relation: { relationTypeKey: "approval_of", from: { type: "approval_item", id: "item-1" }, to: { type: "decision", id: DECISION } } },
      ],
      p_since_seq: 9,
      p_undo_of: null,
    });
  });

  it("reports a waiting approval without recording anything", async () => {
    approvalAnswer = { data: null, error: { message: "This record already has an approval waiting" } };
    const result = await requestObjectApproval({ type: "task", id: DECISION });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(rpcCalls.map((c) => c.fn)).not.toContain("record_change_set");
  });
});
