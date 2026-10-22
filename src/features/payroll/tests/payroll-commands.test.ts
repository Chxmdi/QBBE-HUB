import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_KEYS } from "@/features/payroll/categories";
import { commandContract, everyCommandIsGated, harness, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const commands = await import("../services/payroll.commands");

beforeEach(() => {
  resetHarness();
  harness.rpc = () => ({ data: { added: 1, skipped: 0, ids: [ID] }, error: null });
});

/** A run whose figures add up: gross less employee deductions equals net. */
const zeroRun = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0]));
const run = (cents: Record<string, number>) => ({
  runReference: "2026-20",
  payDate: "2026-10-17",
  periodStart: "2026-10-04",
  periodEnd: "2026-10-17",
  cents,
});

/** One valid call of each write, and the gate it sits behind. */
const VALID: ValidCall[] = [
  ["postPayrollRun", () => commands.postPayrollRun(ID), "admin"],
  ["reversePayrollRun", () => commands.reversePayrollRun({ runId: ID, entryDate: "2026-10-20", memo: "Wrong run" }), "admin"],
  ["deletePayrollDraft", () => commands.deletePayrollDraft(ID), "admin"],
  ["importPayrollRuns", () => commands.importPayrollRuns({ provider: "nethris", fileName: "runs.csv", fileSha256: null, runs: [run(zeroRun)] }), "admin"],
  ["savePayrollAccountMap", () => commands.savePayrollAccountMap([{ category: CATEGORY_KEYS[0], debitAccountId: ID, creditAccountId: null }]), "admin"],
  ["savePayrollAllocation (percent)", () => commands.savePayrollAllocation({ runId: ID, mode: "percent", shares: [{ fundId: ID, value: "60" }, { fundId: ID, programId: ID, value: "40,00" }] }), "admin"],
  ["savePayrollAllocation (amount)", () => commands.savePayrollAllocation({ runId: ID, mode: "amount", shares: [{ fundId: ID, value: "1200.50" }] }), "admin"],
];

describe("payroll commands", () => {
  commandContract(VALID, /^finance\.payroll\.errors\./);
  everyCommandIsGated(commands);

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      commands.postPayrollRun("x"),
      commands.reversePayrollRun({ runId: ID, entryDate: "2026-02-30" }),
      commands.deletePayrollDraft("x"),
      commands.importPayrollRuns({}),
      commands.savePayrollAccountMap({}),
      commands.savePayrollAllocation({}),
      commands.importPayrollRuns({ provider: "nethris", fileName: "runs.csv", fileSha256: null, runs: [] }),
      commands.importPayrollRuns({ provider: "nethris", fileName: "runs.csv", fileSha256: null, runs: [run({ ...zeroRun, [CATEGORY_KEYS[0]]: 100 })] }),
      commands.savePayrollAccountMap([{ category: "bonus_points", debitAccountId: ID, creditAccountId: null }]),
      commands.savePayrollAllocation({ runId: ID, mode: "percent", shares: [{ fundId: ID, value: "sixty" }] }),
      commands.savePayrollAllocation({ runId: ID, mode: "amount", shares: [{ fundId: ID, value: "0" }] }),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });
});
