import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, harness, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

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

  it("names the invoice tax the database refused, with the amount due", async () => {
    harness.rpc = () => ({ data: null, error: { code: "23514", message: "invoice tax", hint: "invoice_tax:gstMismatch:625" } });
    expect(await commands.postDocument({ kind: "invoice", id: ID })).toEqual({
      ok: false,
      error: "finance.payables.errors.invoiceTax.gstMismatch",
    });
    harness.rpc = () => ({ data: null, error: { code: "23514", message: "invoice tax", hint: "invoice_tax:qstNotRegistered" } });
    expect(await commands.postDocument({ kind: "invoice", id: ID })).toEqual({
      ok: false,
      error: "finance.payables.errors.invoiceTax.qstNotRegistered",
    });
    // An unknown hint falls back to the ordinary refusal.
    harness.rpc = () => ({ data: null, error: { code: "XX000", message: "boom", hint: "invoice_tax:somethingElse" } });
    expect(await commands.postDocument({ kind: "invoice", id: ID })).toEqual({ ok: false, error: "finance.payables.errors.post" });
  });

  it("tells a person who did not draft a bill that they cannot request its approval", async () => {
    harness.rpc = () => ({ data: null, error: { code: "42501", message: "not the drafter", hint: "bill_request_not_drafter" } });
    expect(await commands.requestBillApproval(ID)).toEqual({ ok: false, error: "finance.payables.errors.requestNotDrafter" });
  });

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
