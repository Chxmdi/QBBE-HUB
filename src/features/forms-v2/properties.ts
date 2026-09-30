import type { LocalizedText } from "@/lib/objects/contracts";

/**
 * Forms for any type (V1-6): which properties a form can expose, and how
 * answers are read. The database checks the same rules again
 * (app.form_v2_properties_problem, app.form_v2_answers_normalized in
 * migration 20261106110100), so these exist to give a clear message early.
 */

export const FORM_PROPERTY_KINDS = [
  "text",
  "number",
  "currency",
  "date",
  "select",
  "checkbox",
  "url",
  "email",
] as const;
export type FormPropertyKind = (typeof FORM_PROPERTY_KINDS)[number];

export interface FormOption {
  key: string;
  label: LocalizedText;
}

export interface FormV2Property {
  key: string;
  /** `file` only appears on converted forms, which stay drafts until files are supported. */
  kind: FormPropertyKind | "file";
  label: LocalizedText;
  required: boolean;
  options?: FormOption[];
}

export const MAX_PROPERTIES = 50;
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const TYPE_KEY_PATTERN = KEY_PATTERN;

const priorityOptions: FormOption[] = [
  { key: "low", label: { en: "Low", fr: "Basse" } },
  { key: "medium", label: { en: "Medium", fr: "Moyenne" } },
  { key: "high", label: { en: "High", fr: "Haute" } },
  { key: "critical", label: { en: "Critical", fr: "Critique" } },
];

/**
 * The task's system properties a form may ask for (keys as in
 * taskSystemProperties, src/lib/objects/stubs.ts). People, projects and
 * status are set by whoever triages the task, never by the person asking.
 */
export const TASK_FORM_PROPERTIES: readonly FormV2Property[] = [
  { key: "title", kind: "text", required: true, label: { en: "Title", fr: "Titre" } },
  { key: "description", kind: "text", required: false, label: { en: "Details", fr: "Détails" } },
  { key: "priority", kind: "select", required: false, label: { en: "Priority", fr: "Priorité" }, options: priorityOptions },
  { key: "start", kind: "date", required: false, label: { en: "Start", fr: "Début" } },
  { key: "due", kind: "date", required: false, label: { en: "Due", fr: "Échéance" } },
  { key: "estimate", kind: "number", required: false, label: { en: "Estimate (hours)", fr: "Estimation (heures)" } },
];

export type PropertyProblem =
  | "tooMany"
  | "badKey"
  | "duplicateKey"
  | "missingLabel"
  | "badKind"
  | "notATaskProperty"
  | "needsOptions"
  | "taskNeedsTitle";

export function propertiesProblem(typeKey: string, properties: FormV2Property[]): PropertyProblem | null {
  if (properties.length > MAX_PROPERTIES) return "tooMany";
  const seen = new Set<string>();
  for (const p of properties) {
    if (!KEY_PATTERN.test(p.key)) return "badKey";
    if (seen.has(p.key)) return "duplicateKey";
    seen.add(p.key);
    if (!p.label.en.trim() || !p.label.fr.trim()) return "missingLabel";
    if (!(FORM_PROPERTY_KINDS as readonly string[]).includes(p.kind)) return "badKind";
    if (typeKey === "task") {
      const allowed = TASK_FORM_PROPERTIES.find((t) => t.key === p.key);
      if (!allowed || allowed.kind !== p.kind) return "notATaskProperty";
    }
    if (p.kind === "select") {
      const options = p.options ?? [];
      if (options.length === 0 || options.length > 50) return "needsOptions";
      if (options.some((o) => !o.label.en.trim() || !o.label.fr.trim())) return "missingLabel";
    }
  }
  if (typeKey === "task" && !properties.some((p) => p.key === "title" && p.required)) return "taskNeedsTitle";
  return null;
}

/** A property key from its English label: "Needed by?" becomes "needed_by". */
export function keyFromLabel(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 36) || "field";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

/** "Small, Medium" (English) and "Petit, Moyen" (French) become options, paired by position. */
export function optionsFromLists(en: string, fr: string): FormOption[] {
  const english = en.split(",").map((s) => s.trim()).filter(Boolean);
  const french = fr.split(",").map((s) => s.trim());
  const taken = new Set<string>();
  return english.map((label, i) => {
    const key = keyFromLabel(label, taken);
    taken.add(key);
    return { key, label: { en: label, fr: french[i] || label } };
  });
}

export function localized(text: LocalizedText, locale: string): string {
  return locale.startsWith("fr") ? text.fr : text.en;
}

export type AnswerProblem = "required" | "number" | "money" | "date" | "option" | "url" | "email" | "unsupported";

export type ParsedAnswers =
  | { ok: true; answers: Record<string, string | number | boolean> }
  | { ok: false; problem: AnswerProblem; property: FormV2Property };

/**
 * Turns the raw form values into typed answers. Money is typed in dollars and
 * stored in whole cents, as the existing forms do.
 */
export function parseFormAnswers(
  properties: FormV2Property[],
  raw: Record<string, unknown>,
): ParsedAnswers {
  const answers: Record<string, string | number | boolean> = {};
  for (const p of properties) {
    const value = raw[p.key];
    if (p.kind === "checkbox") {
      const ticked = value === true || value === "on";
      if (p.required && !ticked) return { ok: false, problem: "required", property: p };
      answers[p.key] = ticked;
      continue;
    }
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (p.required) return { ok: false, problem: "required", property: p };
      continue;
    }
    switch (p.kind) {
      case "text":
        answers[p.key] = text.slice(0, 5000);
        break;
      case "number": {
        const n = Number(text.replace(",", "."));
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { ok: false, problem: "number", property: p };
        answers[p.key] = n;
        break;
      }
      case "currency": {
        const match = /^\$?\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*\$?$/.exec(text);
        if (!match) return { ok: false, problem: "money", property: p };
        answers[p.key] = Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
        break;
      }
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
          return { ok: false, problem: "date", property: p };
        }
        answers[p.key] = text;
        break;
      case "select":
        if (!(p.options ?? []).some((o) => o.key === text)) return { ok: false, problem: "option", property: p };
        answers[p.key] = text;
        break;
      case "url":
        if (!/^https?:\/\/\S+$/i.test(text)) return { ok: false, problem: "url", property: p };
        answers[p.key] = text;
        break;
      case "email":
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return { ok: false, problem: "email", property: p };
        answers[p.key] = text;
        break;
      default:
        return { ok: false, problem: "unsupported", property: p };
    }
  }
  return { ok: true, answers };
}

/** An answer as text for the responses table. */
export function answerText(property: FormV2Property, value: unknown, locale: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (property.kind === "checkbox") return value === true ? "✓" : "";
  if (property.kind === "select") {
    const option = property.options?.find((o) => o.key === value);
    return option ? localized(option.label, locale) : String(value);
  }
  if (property.kind === "currency" && typeof value === "number") {
    return new Intl.NumberFormat(locale.startsWith("fr") ? "fr-CA" : "en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(value / 100);
  }
  return String(value);
}

