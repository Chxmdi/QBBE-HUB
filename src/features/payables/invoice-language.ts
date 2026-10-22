import { createTranslator } from "@/lib/i18n/translate";
import type { TranslateFn } from "@/lib/i18n/translator";

/**
 * `t()` for the wording of a printed invoice (`finance.payables.invoiceSheet`),
 * in the customer's language whatever language the reader uses. It needs both
 * catalogues, so it is kept apart from model.ts, which the payables forms load
 * in the browser; only the invoice sheet pays for both languages.
 */
export function invoiceTranslator(language: "fr" | "en"): TranslateFn {
  return createTranslator(language === "fr" ? "fr-CA" : "en");
}
