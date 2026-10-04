import type { TranslateFn } from "@/lib/i18n/translate";

/** The parts of the browser's ValidityState a message depends on. */
export type Validity = Pick<
  ValidityState,
  "valid" | "valueMissing" | "badInput" | "stepMismatch" | "rangeUnderflow" | "rangeOverflow" | "tooLong" | "typeMismatch"
>;

/**
 * One plain sentence for why a field's value is not accepted, in the
 * reader's language, or null when it is (audit M3). The browser's own
 * messages vary by browser and language setting; these match the rest of
 * the app.
 */
export function fieldProblem(
  validity: Validity,
  field: { type: string; min?: number; max?: number; maxLength?: number },
  t: TranslateFn,
): string | null {
  if (validity.valid) return null;
  if (validity.valueMissing) return t("ui.fieldErrors.required");
  if (validity.badInput) return t("ui.fieldErrors.number");
  if (validity.rangeUnderflow && field.min !== undefined) return t("ui.fieldErrors.atLeast", { min: field.min });
  if (validity.rangeOverflow && field.max !== undefined) return t("ui.fieldErrors.atMost", { max: field.max });
  if (validity.stepMismatch) return t("ui.fieldErrors.wholeNumber");
  if (validity.tooLong && field.maxLength !== undefined) return t("ui.fieldErrors.tooLong", { max: field.maxLength });
  if (validity.typeMismatch && field.type === "email") return t("ui.fieldErrors.email");
  if (validity.typeMismatch && field.type === "url") return t("ui.fieldErrors.url");
  return t("ui.fieldErrors.invalid");
}
