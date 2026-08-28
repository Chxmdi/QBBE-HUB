import { z } from "zod";
import { requiredText } from "@/lib/schema";

/**
 * The funding and partnership pipeline.
 *
 * Every rule here mirrors a CHECK constraint on `opportunity`. The database is
 * the boundary — these exist so that a person sees "Record what was awarded"
 * instead of `awarded_opportunities_record_the_amount`, and sees it while the
 * form is still open rather than after a round trip.
 *
 * There is deliberately no probability or weighted value: opportunity
 * forecasting is a documented P2 deferral (P2-CRM-07). Stage says where a bid
 * is and amount says what is at stake; nothing here projects.
 */

export const OPPORTUNITY_KINDS = [
  "grant",
  "sponsorship",
  "contract",
  "donation",
  "partnership",
  "in_kind",
] as const;

/** In the order a bid moves through them; settled stages last. */
export const OPPORTUNITY_STAGES = [
  "identified",
  "qualifying",
  "preparing",
  "submitted",
  "awarded",
  "declined",
  "withdrawn",
] as const;

export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/** Stages where the answer is in and the row is history. */
export const SETTLED_STAGES: OpportunityStage[] = [
  "awarded",
  "declined",
  "withdrawn",
];

/** The stages still in play — the same set the database derives `is_open` from. */
export const OPEN_STAGES: OpportunityStage[] = OPPORTUNITY_STAGES.filter(
  (stage) => !SETTLED_STAGES.includes(stage),
);

export function isOpenStage(stage: OpportunityStage): boolean {
  return !SETTLED_STAGES.includes(stage);
}

export const KIND_LABELS: Record<OpportunityKind, string> = {
  grant: "Grant",
  sponsorship: "Sponsorship",
  contract: "Contract",
  donation: "Donation",
  partnership: "Partnership",
  in_kind: "In-kind",
};

export const STAGE_LABELS: Record<OpportunityStage, string> = {
  identified: "Identified",
  qualifying: "Qualifying",
  preparing: "Preparing",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/**
 * Money as it is written down, not as it is stored. `Intl` gets the symbol,
 * grouping and decimal places right for whatever currency the bid is in, which
 * hand-rolled formatting does not.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency = "GBP",
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

/**
 * A decision that has come and gone without an answer. Chasing a funder is the
 * single highest-value thing a fundraiser does, so the pipeline has to say
 * which bids have gone quiet.
 */
export function decisionOverdue(
  opportunity: { stage: OpportunityStage; decision_expected_at: string | null },
  today: string,
): boolean {
  if (!isOpenStage(opportunity.stage)) return false;
  if (!opportunity.decision_expected_at) return false;
  return opportunity.decision_expected_at < today;
}

const awardMessage = "Record what was awarded.";
const refusalMessage = "Say why it was declined or withdrawn.";
const decisionDateMessage = "A settled bid needs the date it was decided.";
const openDecisionMessage =
  "Only a settled bid has a decision date — change the stage first.";
const orderMessage = "A decision cannot predate the submission it decides.";

/**
 * Money arrives from a form as a string, and people type money the way they
 * write it — "25,000", "£25,000". Parsing that here is friendlier than
 * refusing it, and anything still unparseable falls through to the number
 * check so the message names the real problem.
 */
const money = z
  .preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;
      const cleaned = value.replace(/[£$€,\s]/g, "");
      const parsed = Number(cleaned);
      return cleaned !== "" && Number.isFinite(parsed) ? parsed : value;
    },
    z
      .number({ invalid_type_error: "Enter an amount as a number." })
      .nonnegative("Amounts cannot be negative.")
      .max(99_999_999.99, "That amount is larger than this field holds."),
  )
  .optional()
  .nullable();

const isoDate = z.string().trim().max(10);

/**
 * Applied to both create and update, over whatever fields are present. An
 * update that touches only the title must not be judged against a stage it is
 * not changing, so each rule guards on the stage being known.
 */
function settlementRules<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (v: {
        stage?: OpportunityStage;
        amountAwarded?: number | null;
      }) => v.stage !== "awarded" || (v.amountAwarded ?? null) !== null,
      { message: awardMessage, path: ["amountAwarded"] },
    )
    .refine(
      (v: { stage?: OpportunityStage; outcomeNote?: string | null }) =>
        !v.stage ||
        !["declined", "withdrawn"].includes(v.stage) ||
        Boolean(v.outcomeNote),
      { message: refusalMessage, path: ["outcomeNote"] },
    )
    .refine(
      (v: { stage?: OpportunityStage; decidedAt?: string | null }) =>
        !v.stage ||
        !SETTLED_STAGES.includes(v.stage) ||
        Boolean(v.decidedAt),
      { message: decisionDateMessage, path: ["decidedAt"] },
    )
    .refine(
      (v: { stage?: OpportunityStage; decidedAt?: string | null }) =>
        !v.stage || SETTLED_STAGES.includes(v.stage) || !v.decidedAt,
      { message: openDecisionMessage, path: ["decidedAt"] },
    )
    .refine(
      (v: { submittedAt?: string | null; decidedAt?: string | null }) =>
        !v.submittedAt || !v.decidedAt || v.decidedAt >= v.submittedAt,
      { message: orderMessage, path: ["decidedAt"] },
    );
}

const baseFields = {
  title: requiredText("An opportunity needs a title.", 300),
  description: z.string().trim().max(5000).optional(),
  kind: z.enum(OPPORTUNITY_KINDS).default("grant"),
  stage: z.enum(OPPORTUNITY_STAGES).default("identified"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like GBP.")
    .default("GBP"),
  amountRequested: money,
  amountAwarded: money,
  contactId: z.string().uuid().nullable().optional(),
  programId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  submittedAt: isoDate.nullable().optional(),
  decisionExpectedAt: isoDate.nullable().optional(),
  decidedAt: isoDate.nullable().optional(),
  outcomeNote: z.string().trim().max(5000).nullable().optional(),
};

export const createOpportunitySchema = settlementRules(
  z.object({
    crmOrganizationId: z.string().uuid(),
    // Required, unlike the rest of the CRM: a bid nobody owns is a bid nobody
    // submits, and the column is NOT NULL for the same reason.
    ownerId: z
      .string({ required_error: "Every opportunity needs an owner." })
      .uuid({ message: "Every opportunity needs an owner." }),
    ...baseFields,
  }),
);

export const updateOpportunitySchema = settlementRules(
  z.object({
    opportunityId: z.string().uuid(),
    ownerId: z.string().uuid().optional(),
    ...baseFields,
    title: baseFields.title.optional(),
    kind: z.enum(OPPORTUNITY_KINDS).optional(),
    stage: z.enum(OPPORTUNITY_STAGES).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like GBP.")
      .optional(),
  }),
);

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
