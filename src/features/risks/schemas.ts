import { z } from "zod";

/**
 * The risk and issue log.
 *
 * A risk is something that might happen; an issue is something that has. They
 * share a screen because a project lead reviews them together, and they share
 * a link because a risk that materialises becomes an issue — keeping the
 * pointer preserves "we saw this coming", which a status change alone erases.
 */

export const RISK_LIKELIHOODS = ["low", "medium", "high"] as const;
export const RISK_IMPACTS = ["low", "medium", "high"] as const;
export const RISK_STATUSES = ["open", "mitigating", "accepted", "closed"] as const;
export const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ISSUE_STATUSES = ["open", "investigating", "resolved", "closed"] as const;

export type RiskLikelihood = (typeof RISK_LIKELIHOODS)[number];
export type RiskImpact = (typeof RISK_IMPACTS)[number];
export type RiskStatus = (typeof RISK_STATUSES)[number];
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Statuses that mean the risk is no longer being actively worked. */
export const SETTLED_RISK_STATUSES: RiskStatus[] = ["accepted", "closed"];
/** Statuses that mean the issue is no longer being actively worked. */
export const SETTLED_ISSUE_STATUSES: IssueStatus[] = ["resolved", "closed"];

const WEIGHT = { low: 1, medium: 2, high: 3 } as const;

/**
 * The same 1–9 arithmetic the database stores in a generated column. Kept here
 * so a form can show the consequence of a choice before it is saved, and the
 * two are pinned to each other by test.
 */
export function riskScore(likelihood: RiskLikelihood, impact: RiskImpact): number {
  return WEIGHT[likelihood] * WEIGHT[impact];
}

export type RiskBand = "low" | "moderate" | "high" | "severe";

/**
 * A score is for sorting; a band is for reading. The boundaries put anything
 * high on both axes in its own band, because that is the set a lead must act
 * on rather than merely watch.
 */
export function riskBand(score: number): RiskBand {
  if (score >= 9) return "severe";
  if (score >= 6) return "high";
  if (score >= 3) return "moderate";
  return "low";
}

export const RISK_BAND_LABELS: Record<RiskBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};

/** A risk needing review, by its own review date. */
export function riskNeedsReview(
  risk: { status: RiskStatus; review_at: string | null },
  today: string,
): boolean {
  if (SETTLED_RISK_STATUSES.includes(risk.status)) return false;
  if (!risk.review_at) return false;
  return risk.review_at <= today;
}

const settledRiskMessage =
  "Say what you are doing about it, or why you are accepting it.";
const settledIssueMessage = "Record how it was resolved.";

export const createRiskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1, "A risk needs a title.").max(300),
  description: z.string().trim().max(5000).optional(),
  likelihood: z.enum(RISK_LIKELIHOODS).default("medium"),
  impact: z.enum(RISK_IMPACTS).default("medium"),
  mitigation: z.string().trim().max(5000).optional(),
  ownerId: z.string().uuid().optional(),
  reviewAt: z.string().optional(),
});

export const updateRiskSchema = z
  .object({
    riskId: z.string().uuid(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    likelihood: z.enum(RISK_LIKELIHOODS).optional(),
    impact: z.enum(RISK_IMPACTS).optional(),
    status: z.enum(RISK_STATUSES).optional(),
    mitigation: z.string().trim().max(5000).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    reviewAt: z.string().nullable().optional(),
  })
  // Mirrors the database constraint, so the person sees a sentence rather than
  // a constraint name.
  .refine(
    (value) =>
      !value.status ||
      !SETTLED_RISK_STATUSES.includes(value.status) ||
      Boolean(value.mitigation),
    { message: settledRiskMessage, path: ["mitigation"] },
  );

export const createIssueSchema = z.object({
  projectId: z.string().uuid(),
  riskId: z.string().uuid().optional(),
  title: z.string().trim().min(1, "An issue needs a title.").max(300),
  description: z.string().trim().max(5000).optional(),
  severity: z.enum(ISSUE_SEVERITIES).default("medium"),
  ownerId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
});

export const updateIssueSchema = z
  .object({
    issueId: z.string().uuid(),
    title: z.string().trim().min(1).max(300).optional(),
    description: z.string().trim().max(5000).optional(),
    severity: z.enum(ISSUE_SEVERITIES).optional(),
    status: z.enum(ISSUE_STATUSES).optional(),
    resolution: z.string().trim().max(5000).optional(),
    ownerId: z.string().uuid().nullable().optional(),
    dueAt: z.string().nullable().optional(),
  })
  .refine(
    (value) =>
      !value.status ||
      !SETTLED_ISSUE_STATUSES.includes(value.status) ||
      Boolean(value.resolution),
    { message: settledIssueMessage, path: ["resolution"] },
  );

export const escalateRiskSchema = z.object({
  riskId: z.string().uuid(),
  severity: z.enum(ISSUE_SEVERITIES).default("high"),
  description: z.string().trim().max(5000).optional(),
});
