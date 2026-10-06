import { describe, expect, it } from "vitest";
import {
  approvalIssueText,
  approvalRuleSchema,
  decideApprovalSchema,
  describeRange,
  parseAmountToCents,
  submitApprovalSchema,
} from "@/features/approvals/schemas";

describe("parseAmountToCents", () => {
  it("reads dollars into integer cents", () => {
    expect(parseAmountToCents("42.18")).toBe(4218);
    expect(parseAmountToCents("$1,234.5")).toBe(123450);
    expect(parseAmountToCents("5000")).toBe(500000);
    expect(parseAmountToCents(" 0.07 ")).toBe(7);
  });

  it("refuses anything it would have to guess", () => {
    for (const bad of ["", "abc", "-5", "1.234", "12,34", "1e3", "1,23.00"]) {
      expect(parseAmountToCents(bad)).toBeNull();
    }
  });
});

describe("submitApprovalSchema", () => {
  it("requires an amount for money items", () => {
    const result = submitApprovalSchema.safeParse({ subjectType: "purchase", title: "Laptop" });
    expect(result.success).toBe(false);
    expect(approvalIssueText(result.error?.issues[0]?.message ?? "")).toBe("Enter the amount.");
  });

  it("allows a contract without an amount", () => {
    const result = submitApprovalSchema.safeParse({ subjectType: "contract", title: "Lease" });
    expect(result.success && result.data.amount).toBeNull();
  });

  it("keeps the person's message when the title is missing", () => {
    const result = submitApprovalSchema.safeParse({ subjectType: "other" });
    expect(approvalIssueText(result.error?.issues[0]?.message ?? "")).toBe("Say what needs approval.");
  });
});

describe("decideApprovalSchema", () => {
  const itemId = "11111111-2222-4333-8444-555555555555";
  it("needs a reason to reject but not to approve", () => {
    expect(decideApprovalSchema.safeParse({ itemId, decision: "approve" }).success).toBe(true);
    expect(decideApprovalSchema.safeParse({ itemId, decision: "reject" }).success).toBe(false);
    expect(
      decideApprovalSchema.safeParse({ itemId, decision: "reject", note: "Over budget" }).success,
    ).toBe(true);
  });
});

describe("approvalRuleSchema", () => {
  it("needs a person for a named-person rule and an upward range", () => {
    expect(
      approvalRuleSchema.safeParse({ label: "Treasurer", approverKind: "person" }).success,
    ).toBe(false);
    expect(
      approvalRuleSchema.safeParse({
        label: "Director",
        approverKind: "admins",
        minAmount: "5000",
        maxAmount: "500",
      }).success,
    ).toBe(false);
    const ok = approvalRuleSchema.safeParse({
      label: "Director",
      approverKind: "admins",
      minAmount: "500",
      step: "2",
    });
    expect(ok.success && ok.data).toMatchObject({ minAmount: 50000, maxAmount: null, step: 2 });
  });
});

describe("describeRange", () => {
  it("describes thresholds the way the rules read", () => {
    expect(describeRange(0, null)).toBe("Any amount");
    expect(describeRange(0, 50000)).toBe("Under $500.00");
    expect(describeRange(500000, null)).toBe("$5,000.00 and over");
  });
});
