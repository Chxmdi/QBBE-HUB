import type { DbErrorRule } from "@/lib/db-error";

/**
 * The form refusals people can meet, as the database words them, each
 * with its catalogue key. Anything not listed reaches the reader as the
 * action's generic message (and is logged), never as raw database text.
 * Groups capture the values the sentence carries, in the order of `params`;
 * a value the database writes in English (a label) is captured but not shown.
 */
export const FORM_DB_ERRORS: readonly DbErrorRule[] = [
  { key: "forms.dbErrors.publishedLocked", pattern: /^(?:A published form cannot be changed; make a new one)$/ },
  { key: "forms.dbErrors.noBackToDraft", pattern: /^(?:A published form cannot go back to draft)$/ },
  { key: "forms.dbErrors.addField", pattern: /^(?:Add at least one field before publishing)$/ },
  { key: "forms.dbErrors.publishFirst", pattern: /^(?:Publish a draft before closing it)$/ },
  { key: "forms.dbErrors.unknownField", pattern: /^(?:An answer does not match any field on this form)$/ },
  { key: "forms.dbErrors.answerDate", pattern: /^(?:Answer for (.+) must be a date)$/, params: ["field"] },
  { key: "forms.dbErrors.answerNumber", pattern: /^(?:Answer for (.+) must be a number)$/, params: ["field"] },
  { key: "forms.dbErrors.answerAmount", pattern: /^(?:Answer for (.+) must be an amount in whole cents)$/, params: ["field"] },
  { key: "forms.dbErrors.answerFile", pattern: /^(?:Answer for (.+) must be an uploaded file)$/, params: ["field"] },
  { key: "forms.dbErrors.answerOption", pattern: /^(?:Answer for (.+) must be one of its options)$/, params: ["field"] },
  { key: "forms.dbErrors.answerText", pattern: /^(?:Answer for (.+) must be text of up to 5,000 characters)$/, params: ["field"] },
  { key: "forms.dbErrors.answerTick", pattern: /^(?:Answer for (.+) must be ticked or not)$/, params: ["field"] },
  { key: "forms.dbErrors.answerRequired", pattern: /^(?:Answer required: (.+))$/, params: ["field"] },
  { key: "forms.dbErrors.formNotFound", pattern: /^(?:Form not found)$/ },
  { key: "forms.dbErrors.notOpen", pattern: /^(?:This form is not open for submissions)$/ },
  { key: "forms.dbErrors.notOpenToYou", pattern: /^(?:This form is not open to you)$/ },
  { key: "forms.dbErrors.mustSign", pattern: /^(?:This form must be signed: type your name and tick the consent box)$/ },
  { key: "forms.dbErrors.fileAttached", pattern: /^(?:That file is already attached to a submission)$/ },
  { key: "forms.dbErrors.signIn", pattern: /^(?:Sign in to submit a form)$/ },
];
