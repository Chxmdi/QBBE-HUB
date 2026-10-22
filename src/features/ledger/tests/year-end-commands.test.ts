import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, ID, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const commands = await import("../services/year-end.commands");

beforeEach(resetHarness);

/** One valid call of each write, and the gate it sits behind. */
const VALID: ValidCall[] = [
  ["grantAccountantAccess", () => commands.grantAccountantAccess({ userId: ID, expiresOn: "2027-01-31", note: "Audit" }), "admin"],
  ["revokeAccountantAccess", () => commands.revokeAccountantAccess(ID), "admin"],
  ["closeFiscalYear", () => commands.closeFiscalYear({ startsOn: "2026-10-01", confirm: true }), "admin"],
  ["reopenFiscalYear", () => commands.reopenFiscalYear({ startsOn: "2026-10-01", reason: "Late invoice" }), "admin"],
];

describe("year-end commands", () => {
  commandContract(VALID, /^finance\.ledgerReports\.errors\./);
  everyCommandIsGated(commands);

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      commands.grantAccountantAccess({ userId: "x", expiresOn: "2027-01-31" }),
      commands.grantAccountantAccess({ userId: ID, expiresOn: "2027-02-30" }),
      commands.revokeAccountantAccess("x"),
      commands.closeFiscalYear({ startsOn: "2026-10-01", confirm: false }),
      commands.reopenFiscalYear({ startsOn: "2026-10-01", reason: "" }),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });
});
