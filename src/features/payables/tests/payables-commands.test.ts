import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const commands = await import("../services/payables.commands");

beforeEach(resetHarness);

/** One valid call of each write, and the gate it sits behind. */
const VALID: ValidCall[] = [
  ["deleteDraft", () => commands.deleteDraft({ kind: "bill", id: ID }), "staff"],
  ["requestBillApproval", () => commands.requestBillApproval(ID), "staff"],
  ["postDocument", () => commands.postDocument({ kind: "invoice", id: ID }), "admin"],
  ["recordPayment", () => commands.recordPayment({ kind: "bill", documentId: ID, paidOn: "2026-10-15", amount: "125.00", bankAccountId: ID, method: "eft" }), "admin"],
  ["reversePayment", () => commands.reversePayment({ paymentId: ID, date: "2026-10-16", reason: "Duplicate" }), "admin"],
  ["voidDocument", () => commands.voidDocument({ kind: "bill", id: ID, date: "2026-10-16", reason: "Entered twice" }), "admin"],
  ["setBillApprovalThreshold", () => commands.setBillApprovalThreshold({ threshold: "500.00" }), "admin"],
];

describe("payables commands", () => {
  commandContract(VALID, /^finance\.payables\.errors\./);
  everyCommandIsGated(commands, ["saveDocument"]);

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      commands.deleteDraft({ kind: "receipt", id: ID }),
      commands.requestBillApproval("not-an-id"),
      commands.postDocument({ kind: "bill", id: "x" }),
      commands.recordPayment({ kind: "bill", documentId: ID, paidOn: "2026-02-30", amount: "1", bankAccountId: ID, method: "eft" }),
      commands.recordPayment({ kind: "bill", documentId: ID, paidOn: "2026-10-15", amount: "-5", bankAccountId: ID, method: "eft" }),
      commands.recordPayment({ kind: "bill", documentId: ID, paidOn: "2026-10-15", amount: "5", bankAccountId: ID, method: "bitcoin" }),
      commands.reversePayment({ paymentId: ID, date: "" }),
      commands.voidDocument({ kind: "bill", id: ID, date: "2026-10-16", reason: "" }),
      commands.setBillApprovalThreshold({ threshold: "lots" }),
      commands.saveContact({}),
      commands.saveDocument({}),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });
});
