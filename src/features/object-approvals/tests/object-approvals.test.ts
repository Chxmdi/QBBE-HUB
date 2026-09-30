import { describe, expect, it, vi } from "vitest";
import { approvalStepSchema, approvalStepState, isApprovableType, requestApprovalAction } from "../contract";
import { recordHref } from "../services/object-approval.queries";
import { overrideTurnsOn } from "../flag";
import { objectApprovalsEn } from "../i18n/en";
import { objectApprovalsFrCA } from "../i18n/fr-CA";

vi.mock("@/lib/supabase/page", () => ({ createSupabasePageClient: vi.fn() }));

const context = { actor: { kind: "person" as const, id: "me" }, can: async () => true };

describe("object.request_approval action", () => {
  it("asks the engine through request_object_approval and records the new item and its link", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "item-1", error: null });
    const changes = await requestApprovalAction(rpc).run(context, {
      object: { type: "decision", id: "d1" },
      title: "  Print locally ",
      note: "",
    });
    expect(rpc).toHaveBeenCalledWith("request_object_approval", {
      p_object_type: "decision",
      p_object_id: "d1",
      p_title: "Print locally",
      p_note: null,
    });
    expect(changes).toEqual([
      { kind: "create", object: { type: "approval_item", id: "item-1" }, values: { subject: { type: "decision", id: "d1" }, title: "  Print locally " } },
      { kind: "link", relation: { relationTypeKey: "approval_of", from: { type: "approval_item", id: "item-1" }, to: { type: "decision", id: "d1" } } },
    ]);
  });

  it("fails when the database refuses, and refuses types it does not support", async () => {
    const refused = requestApprovalAction(vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }));
    await expect(refused.run(context, { object: { type: "task", id: "t" } })).rejects.toThrow("denied");
    await expect(
      refused.run(context, { object: { type: "invoice" as never, id: "x" } }),
    ).rejects.toThrow("not available");
    expect(isApprovableType("meeting")).toBe(true);
    expect(isApprovableType("page")).toBe(false);
  });
});

describe("approval workflow step", () => {
  const step = { id: "ask", kind: "approval" as const, onApproved: "notify", onRejected: null };

  it("accepts a well-formed step and rejects unknown fields", () => {
    expect(approvalStepSchema.safeParse(step).success).toBe(true);
    expect(approvalStepSchema.safeParse({ ...step, approver: "someone" }).success).toBe(false);
    expect(approvalStepSchema.safeParse({ ...step, onApproved: "bad id!" }).success).toBe(false);
  });

  it("waits while pending, then follows the matching branch", () => {
    expect(approvalStepState(step, "pending")).toEqual({ status: "waiting" });
    expect(approvalStepState(step, "approved")).toEqual({ status: "succeeded", next: "notify", outcome: "approved" });
    expect(approvalStepState(step, "rejected")).toEqual({ status: "succeeded", next: null, outcome: "rejected" });
    expect(approvalStepState(step, "withdrawn")).toEqual({ status: "succeeded", next: null, outcome: "withdrawn" });
  });
});

describe("module plumbing", () => {
  it("links back to each kind of record", () => {
    expect(recordHref("task", "t", null)).toBe("/my-work?task=t");
    expect(recordHref("project", "p", null)).toBe("/projects/p");
    expect(recordHref("meeting", "m", null)).toBe("/meetings/m");
    expect(recordHref("decision", "d", "p")).toBe("/projects/p?tab=risks");
  });

  it("reads the staging override by name", () => {
    expect(overrideTurnsOn("wos_object_approvals", "all")).toBe(true);
    expect(overrideTurnsOn("wos_object_approvals", "wos_objects")).toBe(false);
  });

  it("French has every English key with the same placeholders", () => {
    const leaves = (node: unknown, prefix = ""): [string, string][] =>
      Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
        typeof value === "string" ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
      );
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const fr = new Map(leaves(objectApprovalsFrCA));
    for (const [key, text] of leaves(objectApprovalsEn)) {
      expect(fr.has(key), key).toBe(true);
      expect(placeholders(fr.get(key)!), key).toEqual(placeholders(text));
    }
  });
});
