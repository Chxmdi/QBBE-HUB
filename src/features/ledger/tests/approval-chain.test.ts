import { describe, expect, it } from "vitest";
import { groupApprovalChain, sourceHasApprovals, type ApprovalChainRow } from "@/features/ledger/approval-chain";

function row(partial: Partial<ApprovalChainRow>): ApprovalChainRow {
  return {
    item_id: "item-1",
    item_title: "Bill from Supplies Co",
    item_status: "approved",
    item_amount_cents: 50000,
    item_created_at: "2026-10-02T10:00:00Z",
    occurred_at: "2026-10-02T10:00:00Z",
    kind: "submitted",
    step: null,
    step_label: null,
    actor_name: "QA Staff",
    note: null,
    ...partial,
  };
}

describe("groupApprovalChain", () => {
  it("groups events by approval, in order, and says who did each step", () => {
    const chains = groupApprovalChain([
      row({}),
      row({ kind: "approved", step: 1, step_label: "Treasurer", actor_name: "QA Admin", note: "Matches the quote" }),
      row({ kind: "completed", actor_name: "QA Admin" }),
      row({ item_id: "item-2", item_title: "Second bill", item_status: "pending", item_amount_cents: null }),
      row({
        item_id: "item-2",
        item_status: "pending",
        kind: "waiting",
        step: 1,
        step_label: "Director",
        actor_name: "QA Owner",
        occurred_at: null,
      }),
    ]);
    expect(chains.map((c) => c.itemId)).toEqual(["item-1", "item-2"]);
    expect(chains[0].amountCents).toBe(50000);
    expect(chains[0].steps.map((s) => s.text)).toEqual([
      "Submitted by QA Staff",
      "Approved by QA Admin",
      "Approval complete",
    ]);
    expect(chains[0].steps[1]).toMatchObject({ stepText: "Step 1, Treasurer", note: "Matches the quote" });
    expect(chains[1].amountCents).toBeNull();
    expect(chains[1].steps[1]).toMatchObject({ text: "Waiting for QA Owner", stepText: "Step 1, Director", occurredAt: null });
  });

  it("is empty when nothing was approved", () => {
    expect(groupApprovalChain([])).toEqual([]);
  });

  it("amounts arriving as strings are read as numbers", () => {
    const [chain] = groupApprovalChain([row({ item_amount_cents: "12345" as unknown as number })]);
    expect(chain.amountCents).toBe(12345);
  });
});

describe("sourceHasApprovals", () => {
  it("is true only for bills and payments", () => {
    expect(sourceHasApprovals("finance_bill")).toBe(true);
    expect(sourceHasApprovals("finance_payment")).toBe(true);
    expect(sourceHasApprovals("bank_transaction")).toBe(false);
    expect(sourceHasApprovals(null)).toBe(false);
  });
});
