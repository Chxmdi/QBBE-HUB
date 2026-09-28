import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Display labels for the codes admin screens show (#141). The codes stay as
 * they are in the database; only what a person reads is translated.
 */

/** `t(key)`, or `fallback` when the catalogue has no such key (an unknown code). */
export function labelOr(t: TranslateFn, key: string, fallback: string): string {
  const value = t(key as MessageKey);
  return value === key ? fallback : value;
}

/** Organization role as a lowercase word, e.g. "staff" · "personnel". */
export function roleCodeLabel(role: string, t: TranslateFn): string {
  return labelOr(t, `admin.roleCodes.${role}`, role);
}

/** Program/project access role, e.g. "project manager" · "chargé de projet". */
export function scopeRoleLabel(role: string, t: TranslateFn): string {
  return labelOr(t, `admin.scopeRoles.${role}`, role.replaceAll("_", " "));
}

/** Workflow trigger code as shown in lists, e.g. "task status changed". */
export function triggerEventLabel(event: string, t: TranslateFn): string {
  return labelOr(t, `admin.workspace.workflows.triggerEvents.${event}`, event.replace(/_/g, " "));
}
