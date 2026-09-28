import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

/**
 * Records retention and legal hold (#146).
 *
 * The rules themselves are enforced by the database — the floor per category,
 * who may place a hold, and that a held or retained record cannot be deleted.
 * These schemas only turn a form into the right shape and give a readable
 * sentence for the obvious mistakes before a round trip.
 */

export type RetentionBasis = "fiscal_year_end" | "record_date" | "permanent";

export interface RecordCategory {
  key: string;
  label: string;
  description: string;
  retention_basis: RetentionBasis;
  minimum_years: number | null;
  default_years: number | null;
  legal_reference: string;
  confirm_with: "accountant" | "counsel";
  sort_order: number;
}

export interface RetentionRuleRow {
  category_key: string;
  retain_years: number | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmation_note: string | null;
}

export interface LegalHoldRow {
  id: string;
  scope: "record" | "category";
  category_key: string | null;
  record_type: string | null;
  record_id: string | null;
  reason: string;
  placed_by: string | null;
  placed_at: string;
}

export interface RegisterRow {
  record_type: string;
  record_id: string;
  title: string;
  category_key: string | null;
  record_date: string;
  /** "infinity" for a permanent record, null for an unclassified one. */
  retain_until: string | null;
  held: boolean;
  past_retention: boolean;
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const ENGLISH = createTranslator("en");

/** A month's name (1 = January) in the reader's language. */
export function monthName(month: number, t: TranslateFn = ENGLISH): string {
  return t(`records.months.${month}` as MessageKey);
}

/** Who confirms a category's period ("accountant", "counsel") in the reader's language. */
export function confirmerLabel(
  who: RecordCategory["confirm_with"],
  t: TranslateFn = ENGLISH,
): string {
  return t(`records.who.${who}` as MessageKey);
}

/**
 * A category's label, description and legal reference in the reader's
 * language. They are seeded reference rows, so a known key reads from the
 * catalogue; an unknown one shows what the database holds.
 */
export function localizeCategory<T extends RecordCategory>(category: T, t: TranslateFn): T {
  if (!(category.key in opsEn.records.categories)) return category;
  const base = `records.categories.${category.key}`;
  return {
    ...category,
    label: t(`${base}.label` as MessageKey),
    description: t(`${base}.description` as MessageKey),
    legal_reference: t(`${base}.legalReference` as MessageKey),
  };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** How a category's period reads to a person. */
export function describePeriod(
  category: Pick<RecordCategory, "retention_basis">,
  years: number | null,
  t: TranslateFn = ENGLISH,
): string {
  if (category.retention_basis === "permanent" || years === null) {
    return t("records.period.permanent");
  }
  const one = years === 1;
  return category.retention_basis === "fiscal_year_end"
    ? t(one ? "records.period.fiscalOne" : "records.period.fiscalOther", { n: years })
    : t(one ? "records.period.recordOne" : "records.period.recordOther", { n: years });
}

/**
 * The retention date as a person reads it. `date` formats a YYYY-MM-DD date
 * for display; by default it is shown as stored.
 */
export function describeRetainUntil(
  value: string | null,
  t: TranslateFn = ENGLISH,
  date: (isoDate: string) => string = (isoDate) => isoDate,
): string {
  if (value === null) return t("records.retainUntil.noRule");
  if (value === "infinity") return t("records.retainUntil.permanently");
  return date(value);
}

// Validation messages stay in English here (tests and callers read them); the
// server actions translate them through `records.errors`.

const years = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim()) : value),
  z
    .number({ invalid_type_error: "Enter a number of years." })
    .int("Enter a whole number of years.")
    .min(1, "Enter at least one year.")
    .max(100, "Enter 100 years or fewer."),
);

export const saveRuleSchema = z.object({
  categoryKey: requiredText("Choose a record category.", 60),
  retainYears: years.nullable(),
  confirmed: z.coerce.boolean().default(false),
  confirmationNote: z.string().trim().max(1000).optional(),
});

export const fiscalYearEndSchema = z
  .object({
    month: z.coerce
      .number()
      .int()
      .min(1, "Choose a month.")
      .max(12, "Choose a month."),
    day: z.coerce
      .number()
      .int()
      .min(1, "Choose a day.")
      .max(31, "Choose a day."),
  })
  .refine((value) => value.day <= DAYS_IN_MONTH[value.month - 1], {
    message: "That day does not exist in that month (February 29 is not accepted).",
    path: ["day"],
  });

export const placeHoldSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("category"),
    categoryKey: requiredText("Choose a record category.", 60),
    reason: requiredText("Say why the hold is needed.", 2000).min(3, "Say why the hold is needed."),
  }),
  z.object({
    scope: z.literal("record"),
    recordId: z.string().uuid("Choose a document."),
    reason: requiredText("Say why the hold is needed.", 2000).min(3, "Say why the hold is needed."),
  }),
]);

export const releaseHoldSchema = z.object({
  holdId: z.string().uuid(),
  reason: requiredText("Say why the hold is being released.", 2000).min(
    3,
    "Say why the hold is being released.",
  ),
});

export const classifyDocumentSchema = z.object({
  documentId: z.string().uuid("Choose a document."),
  categoryKey: z.string().trim().max(60).optional(),
  recordDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD.")
    .optional()
    .or(z.literal("")),
});

/** Totals for one organization's register, as the nightly report stores them. */
export function summarizeRegister(rows: RegisterRow[]) {
  const byCategory: Record<string, number> = {};
  let pastRetention = 0;
  let held = 0;
  for (const row of rows) {
    if (row.held) held += 1;
    if (row.past_retention && !row.held) {
      pastRetention += 1;
      const key = row.category_key ?? "unclassified";
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
  }
  return { pastRetention, held, byCategory };
}
