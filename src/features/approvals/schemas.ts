import { z } from "zod";
import { requiredText } from "@/lib/schema";

/**
 * Approval routing (#143). The database decides who may approve what; these
 * schemas only shape input and give people readable messages.
 */

export const SUBJECT_TYPES = [
  "purchase",
  "expense_claim",
  "bill",
  "contract",
  "payment",
  "form",
  "other",
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const SUBJECT_TYPE_LABELS: Record<SubjectType, string> = {
  purchase: "Purchase request",
  expense_claim: "Expense claim",
  bill: "Vendor bill",
  contract: "Contract",
  payment: "Payment",
  form: "Form",
  other: "Other",
};

/** Kinds of item that always carry an amount (the database insists too). */
export const AMOUNT_REQUIRED: ReadonlySet<SubjectType> = new Set([
  "purchase",
  "expense_claim",
  "bill",
  "payment",
]);

export type ApprovalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const STATUS_LABELS: Record<ApprovalStatus, string> = {
  pending: "Waiting",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
} as const;

export const APPROVER_KINDS = ["person", "program_lead", "admins"] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

export const APPROVER_KIND_LABELS: Record<ApproverKind, string> = {
  person: "A named person",
  program_lead: "The program's lead",
  admins: "Any owner or administrator",
};

export const EVENT_LABELS: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  commented: "Commented",
  withdrawn: "Withdrawn",
  completed: "Fully approved",
};

/**
 * "42.18", "1,234.56", "$1 234.56" or "1234" → cents. Returns null for
 * anything that is not a non-negative amount with at most two decimals, so a
 * typo is refused rather than rounded. Money is integer cents end to end.
 */
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[\s  $]/g, "");
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1].replace(/,/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? cents : null;
}

const amountFormatter = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" });

export function formatAmount(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : amountFormatter.format(cents / 100);
}

const optionalAmount = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    const value = (raw ?? "").trim();
    if (value === "") return null;
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Enter the amount in dollars, like 42.18." });
      return z.NEVER;
    }
    return cents;
  });

const optionalUuid = z
  .string()
  .nullish()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());

export const submitApprovalSchema = z
  .object({
    subjectType: z.enum(SUBJECT_TYPES, {
      errorMap: () => ({ message: "Choose what needs approval." }),
    }),
    title: requiredText("Say what needs approval.", 200),
    amount: optionalAmount,
    programId: optionalUuid,
    description: z.string().trim().max(4000).optional(),
  })
  .refine((v) => !AMOUNT_REQUIRED.has(v.subjectType) || v.amount !== null, {
    message: "Enter the amount.",
    path: ["amount"],
  });

export const decideApprovalSchema = z
  .object({
    itemId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === "approve" || Boolean(v.note), {
    message: "Say why you are rejecting it.",
    path: ["note"],
  });

export const commentApprovalSchema = z.object({
  itemId: z.string().uuid(),
  note: requiredText("Write your question or answer.", 2000),
});

export const withdrawApprovalSchema = z.object({
  itemId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

export const approvalRuleSchema = z
  .object({
    label: requiredText("Name the approver, like Executive director.", 100),
    step: z.coerce.number().int().min(1).max(5).default(1),
    subjectType: z
      .string()
      .nullish()
      .transform((v) => (v ? v : null))
      .pipe(z.enum(SUBJECT_TYPES).nullable()),
    programId: optionalUuid,
    minAmount: optionalAmount,
    maxAmount: optionalAmount,
    approverKind: z.enum(APPROVER_KINDS, {
      errorMap: () => ({ message: "Choose who approves." }),
    }),
    approverUserId: optionalUuid,
  })
  .refine((v) => v.approverKind !== "person" || v.approverUserId !== null, {
    message: "Choose the person who approves.",
    path: ["approverUserId"],
  })
  .refine((v) => v.maxAmount === null || v.maxAmount > (v.minAmount ?? 0), {
    message: "The upper amount must be more than the lower amount.",
    path: ["maxAmount"],
  });

/** "Under $500", "$500 to $5,000", "$5,000 and over", "Any amount". */
export function describeRange(min: number, max: number | null): string {
  if (min <= 0 && max === null) return "Any amount";
  if (min <= 0 && max !== null) return `Under ${formatAmount(max)}`;
  if (max === null) return `${formatAmount(min)} and over`;
  return `${formatAmount(min)} up to ${formatAmount(max)}`;
}

const isoDate = (message: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);

/**
 * Away cover: while an approver is away, their delegate decides their steps.
 * Without an approver, the signed-in person delegates their own approvals;
 * naming someone else takes an owner or administrator with MFA.
 */
export const approvalDelegationSchema = z
  .object({
    approverId: optionalUuid,
    delegateId: z.string({ required_error: "Choose who covers." }).uuid("Choose who covers."),
    startsOn: isoDate("Choose the first day."),
    endsOn: isoDate("Choose the last day."),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "The last day must be on or after the first day.",
    path: ["endsOn"],
  });
