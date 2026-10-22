import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const commands = await import("../services/sales-tax.commands");

beforeEach(resetHarness);

/** One valid call of each write, and the gate it sits behind. */
const VALID: ValidCall[] = [
  ["deleteTaxLine", () => commands.deleteTaxLine(ID), "admin"],
  ["importReceipts", () => commands.importReceipts({ from: "2026-10-01", to: "2026-10-31" }), "admin"],
  ["closeTaxPeriod", () => commands.closeTaxPeriod(ID), "admin"],
  ["reopenTaxPeriod", () => commands.reopenTaxPeriod({ periodId: ID, reversalDate: "2026-11-01" }), "admin"],
];

describe("sales tax commands", () => {
  commandContract(VALID, /^finance\.salesTax\.errors\./);
  everyCommandIsGated(commands);

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      commands.deleteTaxLine("x"),
      commands.importReceipts({ from: "2026-13-01", to: "2026-10-31" }),
      commands.closeTaxPeriod("x"),
      commands.reopenTaxPeriod({ periodId: ID, reversalDate: "" }),
      commands.saveTaxSettings({}),
      commands.createTaxPeriod({}),
      commands.saveTaxLine({}),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });
});
