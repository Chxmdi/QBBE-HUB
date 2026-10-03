import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type RpcCall } from "@/lib/objects/testing/fake-db";
import { createTranslator } from "@/lib/i18n/translate";

/**
 * Budget actions: who may run them, what they accept, and how the database's
 * answers reach the person. The arithmetic itself is in budget.test.ts.
 */

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const BUDGET = "77777777-7777-4777-8777-777777777777";
const ACCOUNT = "88888888-8888-4888-8888-888888888888";
const t = createTranslator("en");

let isAdmin = true;
let limited: { ok: false; error: string } | null = null;
let rpcAnswer: (call: RpcCall) => Answer = () => ({ data: null, error: null });
let rpcCalls: RpcCall[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  authorizeAdminAction: async () =>
    isAdmin
      ? { ok: true, session: { userId: ME, organizationId: ORG } }
      : { ok: false, error: "Admins only.", reason: "role" },
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => limited }));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getT: async () => createTranslator("en") };
});
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ rpc: (call) => rpcAnswer(call) });
    rpcCalls = fake.rpcCalls;
    return fake.db;
  },
}));

const budgets = await import("../services/budget.commands");

beforeEach(() => {
  isAdmin = true;
  limited = null;
  rpcCalls = [];
  rpcAnswer = () => ({ data: null, error: null });
});

describe("who may change budgets", () => {
  it("refuses a non-administrator and a person over the rate limit before calling the database", async () => {
    isAdmin = false;
    expect(await budgets.createBudget({ startMonth: "2026-10", name: "FY" })).toEqual({ ok: false, error: "Admins only." });
    expect(await budgets.approveBudget(BUDGET)).toEqual({ ok: false, error: "Admins only." });
    isAdmin = true;
    limited = { ok: false, error: "Slow down." };
    expect(await budgets.saveBudgetLine({})).toEqual({ ok: false, error: "Slow down." });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("createBudget", () => {
  it("starts the fiscal year on the first of the chosen month", async () => {
    rpcAnswer = () => ({ data: BUDGET, error: null });
    expect(await budgets.createBudget({ startMonth: "2026-10", name: "FY 2026-27" })).toEqual({ ok: true, id: BUDGET });
    expect(rpcCalls[0]).toEqual({
      fn: "budget_create",
      args: { p_organization: ORG, p_fiscal_year_start: "2026-10-01", p_name: "FY 2026-27", p_notes: null },
    });
  });

  it("refuses a month that does not exist and a missing name, in the person's words", async () => {
    expect(await budgets.createBudget({ startMonth: "2026-13", name: "FY" })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.startMonth"),
    });
    expect(await budgets.createBudget({ startMonth: "2026-10", name: " " })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.name"),
    });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("saveBudgetLine", () => {
  const line = { budgetId: BUDGET, accountId: ACCOUNT };

  it("splits an annual amount evenly into twelve months of cents", async () => {
    expect(await budgets.saveBudgetLine({ ...line, phasing: "even", annual: "1,200.00" })).toEqual({ ok: true });
    expect(rpcCalls[0].args.p_month_cents).toEqual(Array(12).fill(10000));
  });

  it("takes custom months as typed, a blank month as zero", async () => {
    const months = ["500", ...Array(11).fill("")];
    await budgets.saveBudgetLine({ ...line, phasing: "custom", months });
    expect(rpcCalls[0].args.p_month_cents).toEqual([50000, ...Array(11).fill(0)]);
  });

  it("refuses an unreadable annual amount, a wrong number of months, and names the month that is wrong", async () => {
    expect(await budgets.saveBudgetLine({ ...line, phasing: "even", annual: "lots" })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.annualAmount"),
    });
    expect(await budgets.saveBudgetLine({ ...line, phasing: "custom", months: Array(11).fill("1") })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.eachMonth"),
    });
    const months = ["1", "2", "abc", ...Array(9).fill("1")];
    expect(await budgets.saveBudgetLine({ ...line, phasing: "custom", months })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.monthAmount", { month: 3 }),
    });
    expect(await budgets.saveBudgetLine({ budgetId: BUDGET, accountId: "", phasing: "even", annual: "1" })).toEqual({
      ok: false,
      error: t("finance.budgets.errors.chooseAccount"),
    });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("how database answers reach the person", () => {
  it("shows the database's own sentence for a rule it explains, and hides permission errors", async () => {
    rpcAnswer = () => ({ data: null, error: { code: "22023", message: "An approved budget cannot change." } });
    expect(await budgets.deleteBudgetLine(BUDGET)).toEqual({ ok: false, error: "An approved budget cannot change." });
    rpcAnswer = () => ({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } });
    expect(await budgets.approveBudget(BUDGET)).toEqual({ ok: false, error: t("finance.budgets.errors.approve") });
    rpcAnswer = () => ({ data: null, error: { code: "23503", message: "fk" } });
    expect(await budgets.deleteBudgetDraft(BUDGET)).toEqual({
      ok: false,
      error: t("finance.budgets.errors.notInOrganization"),
    });
  });

  it("refuses an id that is not one before calling the database, and returns a revision's id", async () => {
    expect(await budgets.approveBudget("not-an-id")).toEqual({ ok: false, error: t("finance.budgets.errors.approve") });
    expect(await budgets.reviseBudget("nope")).toEqual({ ok: false, error: t("finance.budgets.errors.revise") });
    expect(rpcCalls).toHaveLength(0);
    rpcAnswer = () => ({ data: "new-version", error: null });
    expect(await budgets.reviseBudget(BUDGET)).toEqual({ ok: true, id: "new-version" });
    expect(rpcCalls[0]).toEqual({ fn: "budget_revise", args: { p_budget: BUDGET } });
  });
});
