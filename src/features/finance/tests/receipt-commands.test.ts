import { beforeEach, describe, expect, it, vi } from "vitest";
import { everyCommandIsGated, harness, ID, ME, ORG, resetHarness, untouched } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const receipts = await import("../services/receipt.commands");

beforeEach(resetHarness);

const receiptTable = (answer: { data: unknown; error: { code?: string; message: string } | null }) => {
  harness.table = (call) => (call.table === "finance_receipt" ? answer : { data: null, error: null });
};

describe("receipt commands", () => {
  everyCommandIsGated(receipts);
});

describe("setReceiptReviewed", () => {
  it("is for staff only, and checks the receipt id before the database", async () => {
    harness.staff = false;
    harness.admin = false;
    await expect(receipts.setReceiptReviewed(ID, true)).rejects.toThrow(/not staff/);
    resetHarness();
    expect(await receipts.setReceiptReviewed("x", true)).toEqual({ ok: false, error: "finance.receipts.errors.notFound" });
    expect(untouched()).toBe(true);
  });

  it("tells staff that only an administrator may review, when the database refuses them", async () => {
    receiptTable({ data: null, error: { code: "42501", message: "permission denied for table finance_receipt" } });
    expect(await receipts.setReceiptReviewed(ID, true)).toEqual({ ok: false, error: "finance.receipts.errors.adminOnly" });
    expect(harness.tableCalls.some((c) => c.table === "audit_event")).toBe(false);
  });

  it("fails when the receipt was not changed, and audits nothing", async () => {
    receiptTable({ data: null, error: null });
    expect(await receipts.setReceiptReviewed(ID, true)).toEqual({ ok: false, error: "finance.receipts.errors.updateFailed" });
    receiptTable({ data: null, error: { message: "timeout" } });
    expect(await receipts.setReceiptReviewed(ID, false)).toEqual({ ok: false, error: "finance.receipts.errors.updateFailed" });
    expect(harness.tableCalls.some((c) => c.table === "audit_event")).toBe(false);
    expect(harness.revalidated).toBe(0);
  });

  it("marks the receipt reviewed and audits who did it", async () => {
    receiptTable({ data: { id: ID }, error: null });
    expect(await receipts.setReceiptReviewed(ID, true)).toEqual({ ok: true, id: ID });
    const update = harness.tableCalls.find((c) => c.table === "finance_receipt");
    expect(update?.payload).toEqual({ status: "reviewed" });
    const audit = harness.tableCalls.find((c) => c.table === "audit_event");
    expect(audit?.payload).toMatchObject({ action: "receipt_reviewed", object_id: ID });
  });
});

describe("openReceiptFile", () => {
  it("gives no link for a receipt the person cannot see, or one not yet scanned clean", async () => {
    expect(await receipts.openReceiptFile("x")).toMatchObject({ ok: false });
    receiptTable({ data: null, error: null });
    expect(await receipts.openReceiptFile(ID)).toEqual({ ok: false, error: "finance.receipts.errors.notAccessible" });
    for (const scan of ["pending", "infected", "error"]) {
      receiptTable({ data: { id: ID, storage_path: "r/1.pdf", scan_status: scan }, error: null });
      expect(await receipts.openReceiptFile(ID)).toEqual({ ok: false, error: "finance.receipts.errors.stillChecking" });
    }
    expect(harness.tableCalls.some((c) => c.table === "audit_event")).toBe(false);
  });
});

describe("registerReceipt and saveReceiptText", () => {
  it("stop a caller over the rate limit, and refuse malformed input before the database", async () => {
    harness.limited = true;
    expect(await receipts.registerReceipt({})).toEqual({ ok: false, error: "slow down" });
    harness.limited = false;
    expect((await receipts.registerReceipt({})).ok).toBe(false);
    expect((await receipts.saveReceiptText({ id: "x", text: "", source: "ocr" })).ok).toBe(false);
    expect((await receipts.saveReceiptText({ id: ID, text: "", source: "camera" })).ok).toBe(false);
    expect(untouched()).toBe(true);
  });

  it("does not say the text was stored when the database refused it", async () => {
    harness.rpc = () => ({ data: null, error: { code: "42501", message: "permission denied" } });
    const result = await receipts.saveReceiptText({ id: ID, text: "Total 12,00 $", source: "pdf_text" });
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/permission denied/);
    harness.rpc = () => ({ data: null, error: null });
    expect(await receipts.saveReceiptText({ id: ID, text: "Total 12,00 $", source: "pdf_text" })).toEqual({ ok: true, id: ID });
  });
});

describe("registerReceipt", () => {
  const receipt = { documentDate: "2026-10-15", vendor: "Bureau en Gros", total: "114.98", gst: "5.00", qst: "9.98", storagePath: "org/r.pdf", fileName: "r.pdf" };

  it("records the receipt as the signed-in person, whatever the input says, and audits it", async () => {
    receiptTable({ data: { id: ID }, error: null });
    expect(await receipts.registerReceipt({ ...receipt, submitted_by: "someone-else" })).toEqual({ ok: true, id: ID });
    const insert = harness.tableCalls.find((c) => c.table === "finance_receipt");
    expect(insert?.payload).toMatchObject({ submitted_by: ME, organization_id: ORG, total_cents: 11498, gst_cents: 500, qst_cents: 998 });
    expect(harness.tableCalls.find((c) => c.table === "audit_event")?.payload).toMatchObject({ action: "receipt_submitted", actor_id: ME });
    expect(harness.revalidated).toBeGreaterThan(0);
  });

  it("refuses taxes larger than the total, and never shows a database message", async () => {
    expect((await receipts.registerReceipt({ ...receipt, gst: "200.00" })).ok).toBe(false);
    expect(untouched()).toBe(true);
    receiptTable({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    expect(await receipts.registerReceipt(receipt)).toEqual({ ok: false, error: "finance.receipts.errors.saveFailed" });
    receiptTable({ data: null, error: { code: "23514", message: "violates check constraint" } });
    expect(await receipts.registerReceipt(receipt)).toEqual({ ok: false, error: "finance.receipts.errors.projectProgram" });
    expect(harness.revalidated).toBe(0);
  });
});
