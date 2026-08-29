import { z } from "zod";

/**
 * Retention policies.
 *
 * The floors live in `retention_subject` and are enforced by a trigger, so a
 * schema here cannot know them statically. What it can do is refuse the
 * obviously wrong shapes and carry the subject's own floor through when the
 * form has it, so an administrator sees a sentence rather than a raised
 * exception surfaced as "save failed".
 */

export const RETENTION_ACTIONS = ["delete", "anonymise"] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];

export const ACTION_LABELS: Record<RetentionAction, string> = {
  delete: "Delete the records",
  anonymise: "Keep the record, remove the content",
};

export interface RetentionSubject {
  key: string;
  label: string;
  description: string;
  minimum_days: number;
  default_days: number;
  allowed_actions: RetentionAction[];
  caution: string | null;
}

/** Years, for a number of days that is only ever read as a duration. */
export function describeDuration(days: number): string {
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/**
 * Whether a proposed policy is allowed by its subject.
 *
 * The same two rules the database trigger enforces. Checking them here means
 * the form can refuse before it saves; the trigger is what actually holds.
 */
export function policyIsAllowed(
  subject: RetentionSubject,
  policy: { retainDays: number; action: RetentionAction },
): { ok: true } | { ok: false; reason: string } {
  if (policy.retainDays < subject.minimum_days) {
    return {
      ok: false,
      reason: `${subject.label} must be kept for at least ${describeDuration(
        subject.minimum_days,
      )}.`,
    };
  }
  if (!subject.allowed_actions.includes(policy.action)) {
    return {
      ok: false,
      reason: `${subject.label} cannot be ${
        policy.action === "anonymise" ? "anonymised" : "deleted"
      }.`,
    };
  }
  return { ok: true };
}

export const savePolicySchema = z.object({
  subjectKey: z.string().min(1).max(60),
  retainDays: z.preprocess(
    (value) => (typeof value === "string" ? Number(value.trim()) : value),
    z
      .number({ invalid_type_error: "Enter a number of days." })
      .int("Enter a whole number of days.")
      .min(1, "Retention has to be at least a day."),
  ),
  action: z.enum(RETENTION_ACTIONS).default("delete"),
  enabled: z.coerce.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});
