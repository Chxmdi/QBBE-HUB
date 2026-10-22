import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandContract, everyCommandIsGated, harness, ID, ORG, RLS, resetHarness, untouched, type ValidCall } from "@/features/finance/testing/command-harness";

vi.mock("@/lib/auth", async () => (await import("@/features/finance/testing/command-harness")).authMock);
vi.mock("@/lib/rate-limit", async () => (await import("@/features/finance/testing/command-harness")).rateLimitMock);
vi.mock("@/lib/supabase/server", async () => (await import("@/features/finance/testing/command-harness")).supabaseMock);
vi.mock("@/lib/i18n/server", async () => (await import("@/features/finance/testing/command-harness")).i18nMock);
vi.mock("next/cache", async () => (await import("@/features/finance/testing/command-harness")).cacheMock);

const ledger = await import("../services/ledger.commands");

beforeEach(() => {
  resetHarness();
  // Writes answer with the new row's id; fund-to-programme links start empty.
  harness.rpc = () => ({ data: ID, error: null });
  harness.table = (call) =>
    call.table === "ledger_fund_program" && call.action === "select" ? { data: [], error: null } : { data: { id: ID }, error: null };
});

/** One valid call of every write, as an owner or admin would make it. */
const VALID: ValidCall[] = [
  ["recordChartApproval", () => ledger.recordChartApproval({ approvedOn: "2026-09-20", approvedByName: "QA Accountant, CPA" }), "admin"],
  ["createFiscalYear", () => ledger.createFiscalYear({ startMonth: "2026-10" }), "admin"],
  ["setPeriodStatus", () => ledger.setPeriodStatus(ID, "closed"), "admin"],
  ["postEntry", () => ledger.postEntry(ID), "admin"],
  ["deleteDraft", () => ledger.deleteDraft(ID), "admin"],
  ["grantLedgerReader", () => ledger.grantLedgerReader(ID), "admin"],
  ["revokeLedgerReader", () => ledger.revokeLedgerReader(ID), "admin"],
  ["saveAccount (new)", () => ledger.saveAccount({ code: "5010", name: "Rent", accountType: "expense" }), "admin"],
  ["saveAccount (edit)", () => ledger.saveAccount({ id: ID, code: "5010", name: "Rent", accountType: "expense", isActive: false }), "admin"],
  ["saveFund", () => ledger.saveFund({ code: "GR-1", name: "Grant", restriction: "externally_restricted", startsOn: "2026-10-01", endsOn: "2027-09-30", programIds: [ID] }), "admin"],
  ["saveEntry", () => ledger.saveEntry({ entryDate: "2026-10-15", memo: "Rent", lines: [
    { accountId: ID, fundId: ID, debit: "100.00" },
    { accountId: ID, fundId: ID, credit: "100.00" },
  ] }), "admin"],
  ["saveEntry (and post)", () => ledger.saveEntry({ entryId: ID, entryDate: "2026-10-15", memo: "Rent", post: true, lines: [
    { accountId: ID, fundId: ID, debit: "100.00" },
    { accountId: ID, fundId: ID, credit: "100.00" },
  ] }), "admin"],
  ["reverseEntry", () => ledger.reverseEntry({ entryId: ID, entryDate: "2026-10-20", memo: "Wrong account" }), "admin"],
  ["releaseRestricted", () => ledger.releaseRestricted({ fromFundId: ID, toFundId: ID, amount: "200.00", releaseDate: "2026-10-05", condition: "Report accepted" }), "admin"],
];

describe("ledger commands", () => {
  commandContract(VALID, /^finance\.ledger\.(release\.)?errors\./);
  everyCommandIsGated(ledger);

  it("refuses malformed input before the database", async () => {
    const results = await Promise.all([
      ledger.recordChartApproval({ approvedOn: "2026-02-30", approvedByName: "x" }),
      ledger.recordChartApproval({ approvedOn: "2026-09-20", approvedByName: "" }),
      ledger.createFiscalYear({ startMonth: "2026-13" }),
      ledger.setPeriodStatus("not-an-id", "open"),
      ledger.setPeriodStatus(ID, "deleted" as "open"),
      ledger.saveAccount({}),
      ledger.saveFund({}),
      ledger.saveEntry({}),
      ledger.reverseEntry({}),
      ledger.releaseRestricted({}),
      ledger.releaseRestricted({ fromFundId: ID, toFundId: ID, amount: "-5", releaseDate: "2026-10-05", condition: "x" }),
      ledger.saveEntry({ entryDate: "2026-10-15", memo: "Off", lines: [
        { accountId: ID, fundId: ID, debit: "100.00" },
        { accountId: ID, fundId: ID, credit: "90.00" },
      ] }),
      ledger.saveEntry({ entryDate: "2026-10-15", memo: "Both", lines: [
        { accountId: ID, fundId: ID, debit: "1", credit: "1" },
        { accountId: ID, fundId: ID, credit: "1" },
      ] }),
      ledger.saveFund({ code: "gr", name: "x", restriction: "unrestricted" }),
      ledger.saveFund({ code: "GR", name: "x", restriction: "unrestricted", startsOn: "2027-01-01", endsOn: "2026-01-01" }),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(untouched()).toBe(true);
  });

  it("explains a reference to something outside the organization and a code already used", async () => {
    harness.rpc = () => ({ data: null, error: { code: "23503", message: "violates foreign key constraint" } });
    expect(await ledger.postEntry(ID)).toEqual({ ok: false, error: "finance.ledger.errors.notInOrganization" });
    harness.rpc = () => ({ data: null, error: { code: "23514", message: 'violates check constraint "x"' } });
    expect(await ledger.postEntry(ID)).toEqual({ ok: false, error: "finance.ledger.errors.checkValues" });
  });


  it("says a saved entry was not posted when the post step fails", async () => {
    harness.rpc = (call) => (call.fn === "ledger_post_entry" ? { data: null, error: { code: "23514", message: "The period is closed." } } : { data: ID, error: null });
    const result = await ledger.saveEntry({ entryDate: "2026-10-15", memo: "Rent", post: true, lines: [
      { accountId: ID, fundId: ID, debit: "100.00" },
      { accountId: ID, fundId: ID, credit: "100.00" },
    ] });
    expect(result).toMatchObject({ ok: false, id: ID, error: "finance.ledger.errors.savedNotPosted" });
  });

  it("reports a fund whose programme links could not be read or saved", async () => {
    const fund = { code: "GR-1", name: "Grant", restriction: "externally_restricted", programIds: [ID] };
    harness.table = (call) =>
      call.table === "ledger_fund_program" ? { data: null, error: { message: "down" } } : { data: { id: ID }, error: null };
    expect(await ledger.saveFund(fund)).toEqual({ ok: false, error: "finance.ledger.errors.fundPrograms" });
    harness.table = (call) =>
      call.table !== "ledger_fund_program"
        ? { data: { id: ID }, error: null }
        : call.action === "select" ? { data: [], error: null } : { data: null, error: RLS };
    expect(await ledger.saveFund(fund)).toEqual({ ok: false, error: "finance.ledger.errors.fundPrograms" });
  });

  it("edits and removes only within the caller's organization, and an edit that matched nothing fails", async () => {
    await ledger.saveAccount({ id: ID, code: "5010", name: "Rent", accountType: "expense" });
    await ledger.revokeLedgerReader(ID);
    for (const call of harness.tableCalls.filter((c) => c.action !== "select" && c.action !== "insert")) {
      expect(call.filters).toContainEqual({ op: "eq", column: "organization_id", value: ORG });
    }
    harness.table = () => ({ data: null, error: null });
    expect(await ledger.saveAccount({ id: ID, code: "5010", name: "Rent", accountType: "expense" })).toEqual({
      ok: false,
      error: "finance.ledger.errors.saveAccount",
    });
  });

  it("passes what was asked to the database", async () => {
    await ledger.setPeriodStatus(ID, "closed");
    await ledger.createFiscalYear({ startMonth: "2026-10" });
    expect(harness.rpcCalls).toEqual([
      { fn: "ledger_set_period_status", args: { p_period: ID, p_status: "closed" } },
      { fn: "ledger_create_fiscal_year", args: { p_organization: ORG, p_starts_on: "2026-10-01" } },
    ]);
  });

  it("gives no available amount to a caller who may not see the ledger", async () => {
    harness.admin = false;
    expect(await ledger.fundAvailableOn(ID, "2026-10-05")).toBeNull();
    expect(untouched()).toBe(true);
  });
});
