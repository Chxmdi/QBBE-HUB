import { describe, expect, it } from "vitest";
import {
  RISK_IMPACTS,
  RISK_LIKELIHOODS,
  SETTLED_ISSUE_STATUSES,
  SETTLED_RISK_STATUSES,
  createRiskSchema,
  escalateRiskSchema,
  riskBand,
  riskNeedsReview,
  riskScore,
  updateIssueSchema,
  updateRiskSchema,
} from "@/features/risks/schemas";

/**
 * The scoring is duplicated between this module and a generated column in
 * Postgres, so the first test pins the two together: if the SQL changes, this
 * table is what should fail.
 */

describe("riskScore", () => {
  it("matches the database's generated column for every combination", () => {
    // Mirrors: (case likelihood ...) * (case impact ...) in the risk table.
    const expected: Record<string, number> = {
      "low/low": 1,
      "low/medium": 2,
      "low/high": 3,
      "medium/low": 2,
      "medium/medium": 4,
      "medium/high": 6,
      "high/low": 3,
      "high/medium": 6,
      "high/high": 9,
    };

    for (const likelihood of RISK_LIKELIHOODS) {
      for (const impact of RISK_IMPACTS) {
        expect(riskScore(likelihood, impact), `${likelihood}/${impact}`).toBe(
          expected[`${likelihood}/${impact}`],
        );
      }
    }
  });

  it("is symmetric — a likely small problem scores as a rare large one", () => {
    expect(riskScore("high", "low")).toBe(riskScore("low", "high"));
  });
});

describe("riskBand", () => {
  it("puts high-on-both in a band of its own", () => {
    expect(riskBand(riskScore("high", "high"))).toBe("severe");
    expect(riskBand(riskScore("high", "medium"))).toBe("high");
    expect(riskBand(riskScore("medium", "medium"))).toBe("moderate");
    expect(riskBand(riskScore("low", "low"))).toBe("low");
  });

  it("covers the whole 1-9 range without a gap", () => {
    const bands = Array.from({ length: 9 }, (_, index) => riskBand(index + 1));
    expect(bands).toEqual([
      "low", "low",
      "moderate", "moderate", "moderate",
      "high", "high", "high",
      "severe",
    ]);
  });
});

describe("riskNeedsReview", () => {
  const today = "2026-08-20";

  it("flags an open risk whose review date has arrived", () => {
    expect(riskNeedsReview({ status: "open", review_at: "2026-08-20" }, today)).toBe(true);
    expect(riskNeedsReview({ status: "open", review_at: "2026-08-01" }, today)).toBe(true);
  });

  it("leaves a future review alone", () => {
    expect(riskNeedsReview({ status: "open", review_at: "2026-09-01" }, today)).toBe(false);
  });

  it("never nags about a risk already settled", () => {
    for (const status of SETTLED_RISK_STATUSES) {
      expect(riskNeedsReview({ status, review_at: "2026-01-01" }, today)).toBe(false);
    }
  });

  it("says nothing about a risk with no review date", () => {
    expect(riskNeedsReview({ status: "open", review_at: null }, today)).toBe(false);
  });
});

describe("settling demands a reason", () => {
  it("refuses to accept or close a risk without a mitigation", () => {
    for (const status of SETTLED_RISK_STATUSES) {
      const result = updateRiskSchema.safeParse({
        riskId: "11111111-1111-4111-8111-111111111111",
        status,
      });
      expect(result.success, status).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/accepting it/);
      }
    }
  });

  it("allows settling once the reasoning is there", () => {
    const result = updateRiskSchema.safeParse({
      riskId: "11111111-1111-4111-8111-111111111111",
      status: "accepted",
      mitigation: "Board accepted this at the August meeting.",
    });
    expect(result.success).toBe(true);
  });

  it("lets a risk move between active statuses freely", () => {
    const result = updateRiskSchema.safeParse({
      riskId: "11111111-1111-4111-8111-111111111111",
      status: "mitigating",
    });
    expect(result.success).toBe(true);
  });

  it("refuses to resolve or close an issue without a resolution", () => {
    for (const status of SETTLED_ISSUE_STATUSES) {
      const result = updateIssueSchema.safeParse({
        issueId: "22222222-2222-4222-8222-222222222222",
        status,
      });
      expect(result.success, status).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toMatch(/how it was resolved/i);
      }
    }
  });

  it("allows resolving with one", () => {
    const result = updateIssueSchema.safeParse({
      issueId: "22222222-2222-4222-8222-222222222222",
      status: "resolved",
      resolution: "Funding confirmed by the city on 14 August.",
    });
    expect(result.success).toBe(true);
  });
});

describe("createRiskSchema", () => {
  it("requires a project and a title", () => {
    expect(createRiskSchema.safeParse({ title: "Orphan risk" }).success).toBe(false);
    expect(
      createRiskSchema.safeParse({
        projectId: "33333333-3333-4333-8333-333333333333",
        title: "   ",
      }).success,
    ).toBe(false);
  });

  it("defaults an unscored risk to the middle of both axes", () => {
    const parsed = createRiskSchema.parse({
      projectId: "33333333-3333-4333-8333-333333333333",
      title: "Funding may slip",
    });
    expect(parsed.likelihood).toBe("medium");
    expect(parsed.impact).toBe("medium");
    expect(riskScore(parsed.likelihood, parsed.impact)).toBe(4);
  });
});

describe("escalateRiskSchema", () => {
  it("treats a materialised risk as high severity unless told otherwise", () => {
    const parsed = escalateRiskSchema.parse({
      riskId: "44444444-4444-4444-8444-444444444444",
    });
    expect(parsed.severity).toBe("high");
  });
});
