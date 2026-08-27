import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPEN_STAGES,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_STAGES,
  SETTLED_STAGES,
  createOpportunitySchema,
  decisionOverdue,
  formatMoney,
  isOpenStage,
  updateOpportunitySchema,
} from "@/features/crm/opportunity-schemas";
import { summarizePipeline } from "@/features/crm/services/opportunity.queries";
import type { OpportunityRow } from "@/features/crm/services/opportunity.queries";

const FUNDER = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

function migration(): string {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((name) => name.endsWith("_opportunity_pipeline.sql"));
  if (!file) throw new Error("the opportunity migration is missing");
  return readFileSync(join(dir, file), "utf8");
}

function row(overrides: Partial<OpportunityRow> = {}): OpportunityRow {
  return {
    id: crypto.randomUUID(),
    title: "Grant",
    description: null,
    kind: "grant",
    stage: "submitted",
    currency: "GBP",
    amount_requested: "1000.00",
    amount_awarded: null,
    submitted_at: null,
    decision_expected_at: null,
    decided_at: null,
    outcome_note: null,
    is_open: true,
    crm_organization: null,
    contact: null,
    owner: null,
    program: null,
    project: null,
    ...overrides,
  };
}

describe("stages", () => {
  it("agrees with the database about which stages are still in play", () => {
    // The migration derives is_open from this exact list. If somebody adds a
    // stage to one side only, the two disagree silently until a total is wrong.
    const sql = migration();
    const derived = sql.slice(sql.indexOf("is_open boolean generated"));
    for (const stage of SETTLED_STAGES) {
      expect(derived).toContain(`'${stage}'`);
    }
    expect(OPEN_STAGES.every(isOpenStage)).toBe(true);
    expect(SETTLED_STAGES.some(isOpenStage)).toBe(false);
    expect([...OPEN_STAGES, ...SETTLED_STAGES].sort()).toEqual(
      [...OPPORTUNITY_STAGES].sort(),
    );
  });

  it("declares the same kinds and stages the enums do", () => {
    const sql = migration();
    for (const kind of OPPORTUNITY_KINDS) expect(sql).toContain(`'${kind}'`);
    for (const stage of OPPORTUNITY_STAGES) expect(sql).toContain(`'${stage}'`);
  });
});

describe("settlement rules", () => {
  const base = {
    crmOrganizationId: FUNDER,
    ownerId: OWNER,
    title: "Youth programme grant",
  };

  it("accepts an ordinary open opportunity", () => {
    const result = createOpportunitySchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("refuses an award with no amount", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "awarded",
      decidedAt: "2026-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Record what was awarded.");
    }
  });

  it("refuses a decline with no reason", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "declined",
      decidedAt: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a settled bid with no decision date", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "withdrawn",
      outcomeNote: "We chose not to bid.",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a decision date on something still in play", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "submitted",
      decidedAt: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("refuses a decision that predates its submission", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "awarded",
      amountAwarded: 500,
      submittedAt: "2026-02-01",
      decidedAt: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a complete award", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      stage: "awarded",
      amountRequested: 25000,
      amountAwarded: 22500,
      submittedAt: "2026-01-01",
      decidedAt: "2026-03-01",
    });
    expect(result.success).toBe(true);
  });

  it("judges an update only on the fields it changes", () => {
    // Renaming a declined opportunity must not demand a reason it already has.
    const result = updateOpportunitySchema.safeParse({
      opportunityId: FUNDER,
      title: "Renamed",
    });
    expect(result.success).toBe(true);
  });
});

describe("amounts", () => {
  const base = { crmOrganizationId: FUNDER, ownerId: OWNER, title: "Grant" };

  it("reads money the way people type it", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      amountRequested: "£25,000",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amountRequested).toBe(25000);
  });

  it("rejects something that is not a number", () => {
    const result = createOpportunitySchema.safeParse({
      ...base,
      amountRequested: "a lot",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter an amount as a number.");
    }
  });

  it("rejects a negative amount", () => {
    expect(
      createOpportunitySchema.safeParse({ ...base, amountRequested: -1 }).success,
    ).toBe(false);
  });

  it("insists on a real currency code", () => {
    expect(
      createOpportunitySchema.safeParse({ ...base, currency: "pounds" }).success,
    ).toBe(false);
    const upper = createOpportunitySchema.safeParse({ ...base, currency: "eur" });
    expect(upper.success).toBe(true);
    if (upper.success) expect(upper.data.currency).toBe("EUR");
  });

  it("formats money in its own currency, and says nothing when there is none", () => {
    expect(formatMoney(25000, "GBP")).toBe("£25,000");
    expect(formatMoney("22500.50", "GBP")).toBe("£22,500.50");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney("")).toBe("—");
  });
});

describe("pipeline totals", () => {
  it("keeps currencies apart instead of adding them together", () => {
    const pipeline = summarizePipeline(
      [
        row({ currency: "GBP", amount_requested: "1000" }),
        row({ currency: "GBP", amount_requested: "500" }),
        row({ currency: "EUR", amount_requested: "2000" }),
      ],
      "2026-01-01",
    );
    expect(pipeline.requestedByCurrency).toEqual([
      { currency: "EUR", total: 2000, count: 1 },
      { currency: "GBP", total: 1500, count: 2 },
    ]);
  });

  it("totals awards from awarded rows only", () => {
    const pipeline = summarizePipeline(
      [
        row({ stage: "awarded", amount_awarded: "900", is_open: false }),
        // A withdrawn bid cannot hold an awarded amount, but a total that
        // trusted the column rather than the stage would be wrong if it did.
        row({ stage: "withdrawn", amount_awarded: "900", is_open: false }),
        row({ stage: "submitted", amount_requested: "100" }),
      ],
      "2026-01-01",
    );
    expect(pipeline.awardedByCurrency).toEqual([
      { currency: "GBP", total: 900, count: 1 },
    ]);
    expect(pipeline.open).toHaveLength(1);
    expect(pipeline.settled).toHaveLength(2);
  });

  it("counts decisions that have come and gone", () => {
    const pipeline = summarizePipeline(
      [
        row({ decision_expected_at: "2025-12-01" }),
        row({ decision_expected_at: "2026-06-01" }),
        row({ decision_expected_at: null }),
        row({ stage: "declined", is_open: false, decision_expected_at: "2025-01-01" }),
      ],
      "2026-01-01",
    );
    expect(pipeline.overdueDecisions).toBe(1);
  });

  it("does not chase a decision on a bid that has already been decided", () => {
    expect(
      decisionOverdue(
        { stage: "declined", decision_expected_at: "2020-01-01" },
        "2026-01-01",
      ),
    ).toBe(false);
    expect(
      decisionOverdue(
        { stage: "submitted", decision_expected_at: "2020-01-01" },
        "2026-01-01",
      ),
    ).toBe(true);
  });
});
