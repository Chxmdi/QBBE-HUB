import { peopleEn } from "@/lib/i18n/messages/workspace/people.en";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Display labels for the CRM's stored codes (#141). The codes stay in the
 * database as they are; only what a person reads is translated. An unknown
 * code (a value added in SQL before the catalogue caught up) shows as itself.
 */

const crm = peopleEn.crm;

function label(group: Record<string, string>, prefix: string, code: string, t: TranslateFn) {
  return code in group ? t(`${prefix}.${code}` as MessageKey) : code;
}

export const categoryLabel = (code: string, t: TranslateFn) =>
  label(crm.categories, "crm.categories", code, t);

export const interactionTypeLabel = (code: string, t: TranslateFn) =>
  label(crm.interactions.types, "crm.interactions.types", code, t);

export const followUpStatusLabel = (code: string, t: TranslateFn) =>
  label(crm.followUps.status, "crm.followUps.status", code, t);

export const agreementStatusLabel = (code: string, t: TranslateFn) =>
  label(crm.agreements.status, "crm.agreements.status", code, t);

export const stageLabel = (code: string, t: TranslateFn) =>
  label(crm.pipeline.stages, "crm.pipeline.stages", code, t);

export const kindLabel = (code: string, t: TranslateFn) =>
  label(crm.pipeline.kinds, "crm.pipeline.kinds", code, t);

/**
 * Translates a message a schema or action produced in English. Schemas keep
 * English text (their tests read it) taken from the catalogue, so the English
 * value leads back to its key. Anything else passes through unchanged.
 */
const KEY_BY_ENGLISH = new Map<string, MessageKey>();
for (const group of ["validation", "errors"] as const) {
  for (const [key, text] of Object.entries(crm[group])) {
    KEY_BY_ENGLISH.set(text, `crm.${group}.${key}` as MessageKey);
  }
}

export function crmMessage(t: TranslateFn, message: string | undefined): string {
  if (message === undefined) return t("crm.errors.invalid");
  const key = KEY_BY_ENGLISH.get(message);
  return key ? t(key) : message;
}
