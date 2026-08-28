import { z } from "zod";
import { requiredText } from "@/lib/schema";

/**
 * Intake: proposing work, and asking a named person to decide.
 *
 * Two shapes, because they answer different questions. A project request is a
 * proposal for work that does not exist yet, and carries the fields a charity
 * actually asks for. An approval request carries no domain fields at all — it
 * records who was asked, what they said, and why.
 *
 * Every rule below mirrors a CHECK constraint. The database is the boundary;
 * these exist so a person reads "Say why you are declining it" rather than
 * `refused_requests_explain_themselves`, and reads it before submitting.
 */

export const PROJECT_REQUEST_STATUSES = [
  "submitted",
  "in_review",
  "approved",
  "declined",
  "withdrawn",
] as const;

export const APPROVAL_DECISIONS = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ProjectRequestStatus = (typeof PROJECT_REQUEST_STATUSES)[number];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** Statuses where the request is still somebody's work. */
export const OPEN_REQUEST_STATUSES: ProjectRequestStatus[] = [
  "submitted",
  "in_review",
];

/** Statuses that refuse a request, and therefore owe an explanation. */
export const REFUSED_REQUEST_STATUSES: ProjectRequestStatus[] = [
  "declined",
  "withdrawn",
];

export function isOpenRequest(status: ProjectRequestStatus): boolean {
  return OPEN_REQUEST_STATUSES.includes(status);
}

export const REQUEST_STATUS_LABELS: Record<ProjectRequestStatus, string> = {
  submitted: "Submitted",
  in_review: "In review",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const DECISION_LABELS: Record<ApprovalDecision, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** How long a request has been waiting, in whole days. */
export function daysWaiting(since: string, now: Date): number {
  const submitted = new Date(since).getTime();
  if (!Number.isFinite(submitted)) return 0;
  return Math.max(0, Math.floor((now.getTime() - submitted) / 86_400_000));
}

/**
 * A request nobody has touched. Not an error — intake queues go quiet — but
 * the one thing the queue should say out loud, because the cost of a silent
 * queue falls on the person who proposed something and heard nothing.
 */
export const STALE_AFTER_DAYS = 14;

export function requestIsStale(
  request: { status: ProjectRequestStatus; created_at: string },
  now: Date,
): boolean {
  if (!isOpenRequest(request.status)) return false;
  return daysWaiting(request.created_at, now) >= STALE_AFTER_DAYS;
}

export const createProjectRequestSchema = z.object({
  title: requiredText("Give the proposal a name.", 300),
  summary: requiredText(
    "Say what you are proposing — a title on its own is not a request.",
    5000,
  ),
  rationale: z.string().trim().max(5000).optional(),
  beneficiaries: z.string().trim().max(2000).optional(),
  programId: z.string().uuid().nullable().optional(),
  sponsorId: z.string().uuid().nullable().optional(),
  neededBy: z.string().trim().max(10).nullable().optional(),
  estimatedEffort: z.string().trim().max(200).optional(),
});

export const decideProjectRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(PROJECT_REQUEST_STATUSES),
    decisionNote: z.string().trim().max(5000).optional(),
    /** Only used when approving: the project may be named differently. */
    projectName: z.string().trim().max(200).optional(),
  })
  .refine(
    (value) =>
      !REFUSED_REQUEST_STATUSES.includes(value.status) ||
      Boolean(value.decisionNote),
    {
      message: "Say why — the next person to propose this needs to know.",
      path: ["decisionNote"],
    },
  );

export const updateProjectRequestSchema = createProjectRequestSchema
  .partial()
  .extend({ requestId: z.string().uuid() });

/**
 * Exactly one subject, mirroring `exactly_one_subject`. A request pointing at
 * two things is a request nobody can answer; one pointing at nothing is an
 * approval of the void.
 */
export const requestApprovalSchema = z
  .object({
    approverId: z
      .string({ required_error: "Name the person who should decide." })
      .uuid({ message: "Name the person who should decide." }),
    note: z.string().trim().max(2000).optional(),
    dueAt: z.string().trim().max(10).nullable().optional(),
    projectRequestId: z.string().uuid().optional(),
    reportId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .refine(
    (value) =>
      [value.projectRequestId, value.reportId, value.opportunityId].filter(
        Boolean,
      ).length === 1,
    { message: "An approval is about exactly one record.", path: ["projectRequestId"] },
  );

export const decideApprovalSchema = z
  .object({
    approvalId: z.string().uuid(),
    decision: z.enum(["approved", "rejected", "withdrawn"]),
    decisionNote: z.string().trim().max(5000).optional(),
  })
  .refine(
    (value) => value.decision !== "rejected" || Boolean(value.decisionNote),
    {
      message: "Say why you are rejecting it.",
      path: ["decisionNote"],
    },
  );
