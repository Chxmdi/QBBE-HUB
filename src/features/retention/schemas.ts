import { z } from "zod";
import { opsEn } from "@/lib/i18n/messages/workspace/ops.en";
import { createTranslator, type MessageKey, type TranslateFn } from "@/lib/i18n/translate";

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

const ENGLISH = createTranslator("en");

/** How an action reads, in the reader's language. */
export function actionLabel(action: RetentionAction, t: TranslateFn = ENGLISH): string {
  return t(`retention.actions.${action}` as MessageKey);
}

export interface RetentionSubject {
  key: string;
  label: string;
  description: string;
  minimum_days: number;
  default_days: number;
  allowed_actions: RetentionAction[];
  caution: string | null;
}

/**
 * Years, for a number of days that is only ever read as a duration.
 *
 * `t` and `number` pick the language ("2,5 ans" in French); English by
 * default, which is what tests and shared callers read.
 */
export function describeDuration(
  days: number,
  t: TranslateFn = ENGLISH,
  number: (value: number) => string = String,
): string {
  if (days < 30) {
    return t(days === 1 ? "retention.duration.dayOne" : "retention.duration.dayOther", {
      n: number(days),
    });
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    return t(months === 1 ? "retention.duration.monthOne" : "retention.duration.monthOther", {
      n: number(months),
    });
  }
  const years = Math.round((days / 365) * 10) / 10;
  return t(years === 1 ? "retention.duration.yearOne" : "retention.duration.yearOther", {
    n: number(years),
  });
}

type SubjectText = Pick<RetentionSubject, "key" | "label" | "description" | "caution">;

/**
 * A subject's label, description and caution in the reader's language. They
 * are seeded reference rows, so a known key reads from the catalogue; an
 * unknown one shows what the database holds.
 */
export function localizeSubject<T extends SubjectText>(subject: T, t: TranslateFn): T {
  if (!(subject.key in opsEn.retention.subjects)) return subject;
  const base = `retention.subjects.${subject.key}`;
  return {
    ...subject,
    label: t(`${base}.label` as MessageKey),
    description: t(`${base}.description` as MessageKey),
    caution: subject.caution === null ? null : t(`${base}.caution` as MessageKey),
  };
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
  t: TranslateFn = ENGLISH,
  number: (value: number) => string = String,
): { ok: true } | { ok: false; reason: string } {
  if (policy.retainDays < subject.minimum_days) {
    return {
      ok: false,
      reason: t("retention.errors.mustKeep", {
        label: subject.label,
        duration: describeDuration(subject.minimum_days, t, number),
      }),
    };
  }
  if (!subject.allowed_actions.includes(policy.action)) {
    return {
      ok: false,
      reason: t(
        policy.action === "anonymise"
          ? "retention.errors.cannotAnonymise"
          : "retention.errors.cannotDelete",
        { label: subject.label },
      ),
    };
  }
  return { ok: true };
}

export const savePolicySchema = z.object({
  subjectKey: z.string().min(1).max(60),
  retainDays: z.preprocess(
    (value) => (typeof value === "string" ? Number(value.trim()) : value),
    z
      // English here; the server action translates through `retention.errors`.
      .number({ invalid_type_error: "Enter a number of days." })
      .int("Enter a whole number of days.")
      .min(1, "Retention has to be at least a day."),
  ),
  action: z.enum(RETENTION_ACTIONS).default("delete"),
  enabled: z.coerce.boolean().default(false),
  note: z.string().trim().max(1000).optional(),
});
