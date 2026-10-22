import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, harness, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const commands = await import("../services/bank.commands");

beforeEach(resetHarness);

/** One valid call of each write, and the gate it sits behind. */
const VALID: ValidCall[] = [
  ["deleteImport", () => commands.deleteImport(ID), "admin"],
  ["matchLine", () => commands.matchLine(ID, ID, "manual"), "admin"],
  ["unmatchLine", () => commands.unmatchLine(ID), "admin"],
  ["startReconciliation", () => commands.startReconciliation({ bankAccountId: ID, statementStart: "2026-10-01", statementEnd: "2026-10-31", openingBalance: "100.00", closingBalance: "-25.50" }), "admin"],
  ["updateReconciliationBalances", () => commands.updateReconciliationBalances({ reconciliationId: ID, openingBalance: "100.00", closingBalance: "90.00" }), "admin"],
  ["setReconciliationStatus", () => commands.setReconciliationStatus(ID, "reconciled"), "admin"],
  ["deleteReconciliation", () => commands.deleteReconciliation(ID), "admin"],
];

describe("bank commands", () => {
  commandContract(VALID, /^finance\.bank\.errors\./);
  everyCommandIsGated(commands);

  it("stops accepting suggestions at the first refusal and says how many were matched", async () => {
    let calls = 0;
    harness.rpc = () => (++calls === 2 ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: null, error: null });
    const result = await commands.acceptSuggestions([
      { transactionId: ID, journalLineId: ID },
      { transactionId: ID, journalLineId: ID },
      { transactionId: ID, journalLineId: ID },
    ]);
    expect(result).toMatchObject({ ok: false, matched: 1 });
    expect(result.error).not.toMatch(/permission denied/);
    expect(calls).toBe(2);
  });

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      commands.deleteImport("x"),
      commands.matchLine(ID, "x", "manual"),
      commands.unmatchLine(""),
      commands.startReconciliation({ bankAccountId: ID, statementStart: "2026-10-31", statementEnd: "2026-10-01", openingBalance: "1", closingBalance: "1" }),
      commands.updateReconciliationBalances({ reconciliationId: ID, openingBalance: "abc", closingBalance: "1" }),
      commands.setReconciliationStatus(ID, "closed" as "open"),
      commands.deleteReconciliation("x"),
      commands.acceptSuggestions([]),
      commands.saveBankAccount({}),
      commands.importStatement({}),
      commands.createEntryFromLine({}),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });
});
