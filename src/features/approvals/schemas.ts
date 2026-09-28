import { z } from "zod";
import { requiredText } from "@/lib/schema";
import type { Locale } from "@/lib/i18n/config";
import { formatCurrency } from "@/lib/i18n/format";
import { createTranslator, type MessageKey } from "@/lib/i18n/translate";

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

export const SUBJECT_TYPE_LABELS: Record<SubjectType, MessageKey> = {
  purchase: "finance.approvals.subjectTypes.purchase",
  expense_claim: "finance.approvals.subjectTypes.expense_claim",
  bill: "finance.approvals.subjectTypes.bill",
  contract: "finance.approvals.subjectTypes.contract",
  payment: "finance.approvals.subjectTypes.payment",
  form: "finance.approvals.subjectTypes.form",
  other: "finance.approvals.subjectTypes.other",
};

/** Kinds of item that always carry an amount (the database insists too). */
export const AMOUNT_REQUIRED: ReadonlySet<SubjectType> = new Set([
  "purchase",
  "expense_claim",
  "bill",
  "payment",
]);

export type ApprovalStatus = "pending" | "approved" | "rejected" | "withdrawn";

export const STATUS_LABELS: Record<ApprovalStatus, MessageKey> = {
  pending: "finance.approvals.statuses.pending",
  approved: "finance.approvals.statuses.approved",
  rejected: "finance.approvals.statuses.rejected",
  withdrawn: "finance.approvals.statuses.withdrawn",
};

export const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  withdrawn: "neutral",
} as const;

export const APPROVER_KINDS = ["person", "program_lead", "admins"] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

export const APPROVER_KIND_LABELS: Record<ApproverKind, MessageKey> = {
  person: "finance.approvals.approverKinds.person",
  program_lead: "finance.approvals.approverKinds.program_lead",
  admins: "finance.approvals.approverKinds.admins",
};

export const EVENT_LABELS: Record<string, MessageKey> = {
  submitted: "finance.approvals.events.submitted",
  approved: "finance.approvals.events.approved",
  rejected: "finance.approvals.events.rejected",
  commented: "finance.approvals.events.commented",
  withdrawn: "finance.approvals.events.withdrawn",
  completed: "finance.approvals.events.completed",
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

export function formatAmount(cents: number | null | undefined, locale: Locale = "en"): string {
  if (cents === null || cents === undefined) return "—";
  return locale === "en" ? amountFormatter.format(cents / 100) : formatCurrency(cents / 100, locale);
}

const optionalAmount = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    const value = (raw ?? "").trim();
    if (value === "") return null;
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "finance.approvals.validation.amountFormat" satisfies MessageKey });
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
      errorMap: () => ({ message: "finance.approvals.validation.chooseSubject" satisfies MessageKey }),
    }),
    title: requiredText("finance.approvals.validation.titleRequired" satisfies MessageKey, 200),
    amount: optionalAmount,
    programId: optionalUuid,
    description: z.string().trim().max(4000).optional(),
  })
  .refine((v) => !AMOUNT_REQUIRED.has(v.subjectType) || v.amount !== null, {
    message: "finance.approvals.validation.amountRequired" satisfies MessageKey,
    path: ["amount"],
  });

export const decideApprovalSchema = z
  .object({
    itemId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === "approve" || Boolean(v.note), {
    message: "finance.approvals.validation.rejectReason" satisfies MessageKey,
    path: ["note"],
  });

export const commentApprovalSchema = z.object({
  itemId: z.string().uuid(),
  note: requiredText("finance.approvals.validation.commentRequired" satisfies MessageKey, 2000),
});

export const withdrawApprovalSchema = z.object({
  itemId: z.string().uuid(),
  note: z.string().trim().max(2000).optional(),
});

export const approvalRuleSchema = z
  .object({
    label: requiredText("finance.approvals.validation.ruleLabelRequired" satisfies MessageKey, 100),
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
      errorMap: () => ({ message: "finance.approvals.validation.chooseApproverKind" satisfies MessageKey }),
    }),
    approverUserId: optionalUuid,
  })
  .refine((v) => v.approverKind !== "person" || v.approverUserId !== null, {
    message: "finance.approvals.validation.choosePerson" satisfies MessageKey,
    path: ["approverUserId"],
  })
  .refine((v) => v.maxAmount === null || v.maxAmount > (v.minAmount ?? 0), {
    message: "finance.approvals.validation.rangeOrder" satisfies MessageKey,
    path: ["maxAmount"],
  });

/**
 * Validation messages above are catalogue keys; this turns one into the
 * sentence for `locale`. Anything that is not a key (Zod's own wording) is
 * shown as it is.
 */
export function approvalIssueText(message: string, locale: Locale = "en"): string {
  return message.startsWith("finance.approvals.")
    ? createTranslator(locale)(message as MessageKey)
    : message;
}

/** "Under $500", "$500 to $5,000", "$5,000 and over", "Any amount". */
export function describeRange(min: number, max: number | null, locale: Locale = "en"): string {
  const t = createTranslator(locale);
  if (min <= 0 && max === null) return t("finance.approvals.range.any");
  if (min <= 0 && max !== null) return t("finance.approvals.range.under", { max: formatAmount(max, locale) });
  if (max === null) return t("finance.approvals.range.andOver", { min: formatAmount(min, locale) });
  return t("finance.approvals.range.between", {
    min: formatAmount(min, locale),
    max: formatAmount(max, locale),
  });
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
    delegateId: z.string({ required_error: "finance.approvals.away.errors.chooseDelegate" }).uuid("finance.approvals.away.errors.chooseDelegate"),
    startsOn: isoDate("finance.approvals.away.errors.chooseFirstDay"),
    endsOn: isoDate("finance.approvals.away.errors.chooseLastDay"),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    message: "finance.approvals.away.errors.lastBeforeFirst",
    path: ["endsOn"],
  });
