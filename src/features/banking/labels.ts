import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Bank names by institution value (#141). Plain module, not "use client", so
 * server pages and client forms can both call it.
 */
export const INSTITUTION_KEY: Record<string, MessageKey> = {
  desjardins: "finance.bank.institutions.desjardins",
  national_bank: "finance.bank.institutions.national_bank",
  rbc: "finance.bank.institutions.rbc",
  td: "finance.bank.institutions.td",
  bmo: "finance.bank.institutions.bmo",
  other: "finance.bank.institutions.other",
};

/** The bank's name in the reader's language; an unknown value is shown as is. */
export function institutionLabel(t: TranslateFn, institution: string): string {
  const key = INSTITUTION_KEY[institution];
  return key ? t(key) : institution;
}
