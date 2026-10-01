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
  "file",
] as const;
export type FormPropertyKind = (typeof FORM_PROPERTY_KINDS)[number];

export interface FormOption {
  key: string;
  label: LocalizedText;
}

export const SHOW_IF_OPS = ["eq", "neq", "is_empty", "is_not_empty", "contains"] as const;
export type ShowIfOp = (typeof SHOW_IF_OPS)[number];

/** Ask this question only while an earlier question's answer meets the condition. */
export interface ShowIf {
  /** The key of an earlier property on the same form. */
  key: string;
  op: ShowIfOp;
  /** Absent for is_empty and is_not_empty. */
  value?: string | number | boolean;
}

export interface FormV2Property {
  key: string;
  /** A `file` answer is the id of a library document the submitter uploaded. */
  kind: FormPropertyKind;
  label: LocalizedText;
  required: boolean;
  options?: FormOption[];
  showIf?: ShowIf;
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
  | "taskNeedsTitle"
  | "badCondition";

/** Whether a showIf is well formed against the properties before it. */
function showIfProblem(property: FormV2Property, earlier: readonly FormV2Property[]): PropertyProblem | null {
  const s = property.showIf;
  if (!s) return null;
  const ref = earlier.find((e) => e.key === s.key);
  if (!ref || !(SHOW_IF_OPS as readonly string[]).includes(s.op)) return "badCondition";
  if (s.op === "is_empty" || s.op === "is_not_empty") {
    return s.value === undefined || s.value === null ? null : "badCondition";
  }
  if (ref.kind === "file") return "badCondition";
  if (typeof s.value === "string") {
    if (!s.value.trim() || s.value.trim().length > 200) return "badCondition";
  } else if (typeof s.value !== "number" && typeof s.value !== "boolean") {
    return "badCondition";
  }
  if (ref.kind === "checkbox" && (s.op === "contains" || typeof s.value !== "boolean")) return "badCondition";
  if (ref.kind === "select" && s.op !== "contains" && !(ref.options ?? []).some((o) => o.key === s.value)) {
    return "badCondition";
  }
  return null;
}

export function propertiesProblem(typeKey: string, properties: FormV2Property[]): PropertyProblem | null {
  if (properties.length > MAX_PROPERTIES) return "tooMany";
  const seen = new Set<string>();
  for (const [index, p] of properties.entries()) {
    if (!KEY_PATTERN.test(p.key)) return "badKey";
    if (seen.has(p.key)) return "duplicateKey";
    seen.add(p.key);
    if (!p.label.en.trim() || !p.label.fr.trim()) return "missingLabel";
    if (!(FORM_PROPERTY_KINDS as readonly string[]).includes(p.kind)) return "badKind";
    if (typeKey === "task") {
      const allowed = TASK_FORM_PROPERTIES.find((t) => t.key === p.key);
      if (!allowed || allowed.kind !== p.kind) return "notATaskProperty";
      if (p.key === "title" && p.showIf) return "badCondition";
    }
    if (p.kind === "select") {
      const options = p.options ?? [];
      if (options.length === 0 || options.length > 50) return "needsOptions";
      if (options.some((o) => !o.label.en.trim() || !o.label.fr.trim())) return "missingLabel";
    }
    const condition = showIfProblem(p, properties.slice(0, index));
    if (condition) return condition;
  }
  if (typeKey === "task" && !properties.some((p) => p.key === "title" && p.required)) return "taskNeedsTitle";
  return null;
}

/** Missing, null, blank text or an unticked box. */
function isEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return true;
  return typeof value === "string" && value.trim() === "";
}

function answerAsText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * The properties shown for these answers, in order. A property with no
 * condition is shown; one with a condition is shown when the property it
 * depends on is itself shown and its answer meets the condition. Pure, and
 * the same rule as app.form_v2_visible_keys on the server, so a question the
 * browser hides is one the server ignores.
 */
export function visibleFields(
  properties: readonly FormV2Property[],
  answers: Record<string, unknown>,
): FormV2Property[] {
  const shown: FormV2Property[] = [];
  for (const p of properties) {
    const s = p.showIf;
    if (!s) {
      shown.push(p);
      continue;
    }
    if (!shown.some((e) => e.key === s.key)) continue;
    const answer = answers[s.key];
    const empty = isEmptyAnswer(answer);
    const text = answerAsText(answer);
    const wanted = s.value === undefined || s.value === null ? "" : String(s.value);
    let ok = false;
    switch (s.op) {
      case "is_empty":
        ok = empty;
        break;
      case "is_not_empty":
        ok = !empty;
        break;
      case "eq":
        ok = !empty && text === wanted;
        break;
      case "neq":
        ok = empty || text !== wanted;
        break;
      case "contains":
        ok = !empty && text.toLowerCase().includes(wanted.toLowerCase());
        break;
    }
    if (ok) shown.push(p);
  }
  return shown;
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

export type AnswerProblem = "required" | "number" | "money" | "date" | "option" | "url" | "email" | "file" | "unsupported";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedAnswers =
  | { ok: true; answers: Record<string, string | number | boolean> }
  | { ok: false; problem: AnswerProblem; property: FormV2Property };

/**
 * Turns the raw form values into typed answers. Money is typed in dollars and
 * stored in whole cents, as the existing forms do. Hidden questions (see
 * visibleFields) are left out, whatever was sent for them.
 */
export function parseFormAnswers(
  properties: FormV2Property[],
  raw: Record<string, unknown>,
): ParsedAnswers {
  const answers: Record<string, string | number | boolean> = {};
  for (const p of visibleFields(properties, raw)) {
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
      case "file":
        if (!UUID_PATTERN.test(text)) return { ok: false, problem: "file", property: p };
        answers[p.key] = text.toLowerCase();
        break;
      default:
        return { ok: false, problem: "unsupported", property: p };
    }
  }
  return { ok: true, answers };
}

/** An answer as text for the responses table; a file answer is shown by its document instead. */
export function answerText(property: FormV2Property, value: unknown, locale: string): string {
  if (value === undefined || value === null || value === "") return "";
  if (property.kind === "checkbox") return value === true ? "✓" : "";
  if (property.kind === "file") return "";
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

