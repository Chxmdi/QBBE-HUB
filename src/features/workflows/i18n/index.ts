import type { Locale } from "@/lib/i18n/config";
import { interpolate, type MessageVars } from "@/lib/i18n/translate";
import { workflowsEn, type WorkflowsMessages } from "./workflows.en";
import { workflowsFrCA } from "./workflows.fr-CA";

/**
 * The workflow module's own dictionaries (Workspace OS S6), kept out of the
 * shared catalogue until integration mounts them. Pages pick one with
 * `workflowMessages(locale)` and hand it to client components as a prop.
 */

export type { WorkflowsMessages };

export function workflowMessages(locale: Locale): WorkflowsMessages {
  return locale === "fr-CA" ? workflowsFrCA : workflowsEn;
}

/** Fills `{name}` placeholders, as the shared `t()` does. */
export function fill(template: string, vars?: MessageVars): string {
  return interpolate(template, vars);
}
