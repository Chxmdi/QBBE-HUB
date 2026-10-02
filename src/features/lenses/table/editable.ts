import type { CatalogChoice } from "@/lib/query/catalog";
import type { LensValue } from "@/lib/query/run";

/**
 * Cells the table lens edits in place (M8b). Each maps to an existing command
 * (src/features/tasks/services/task.commands.ts), so validation, notifications
 * and task history stay the same as editing from the task drawer. This is the
 * set while the wos_objects switch is off; bulk edit offers the same.
 */
export const EDITABLE = {
  task: {
    title: "text",
    status: "select",
    priority: "select",
    due: "date",
    assignee: "person",
    reviewer: "person",
  },
} as const satisfies Record<string, Record<string, "text" | "select" | "date" | "person">>;

export type EditableType = keyof typeof EDITABLE;

/** Every editor the table has (wave 2 unit D1). */
export const EDITOR_KINDS = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "person",
  "checkbox",
  "relation",
  "url",
  "email",
] as const;
export type EditorKind = (typeof EDITOR_KINDS)[number];

export function editorFor(type: string, property: string): EditorKind | null {
  const byType = (EDITABLE as Record<string, Record<string, EditorKind>>)[type];
  return byType?.[property] ?? null;
}

/**
 * Wave 2 unit D1 (switches wos_lenses + wos_objects): every property the table
 * shows that has a writable registered property (property_definition with a
 * native column the object writer accepts). Task fields with a command are
 * saved through it (notifications and history unchanged); the rest through
 * object.set_property. Either way each change is a change set that can be
 * undone. Computed, timestamp and filter-only properties are not here, so
 * they stay read-only.
 */
export const CELL_EDITABLE = {
  task: {
    title: "text",
    status: "select",
    priority: "select",
    assignee: "person",
    requester: "person",
    reviewer: "person",
    approver: "person",
    start: "date",
    due: "date",
    estimate: "number",
    project: "relation",
    program: "relation",
    milestone: "relation",
    blocked_reason: "text",
  },
  project: {
    title: "text",
    stage: "select",
    health: "select",
    priority: "select",
    owner: "person",
    start: "date",
    target: "date",
    program: "relation",
  },
} as const satisfies Record<string, Record<string, EditorKind>>;

/** Properties that must always hold a value. */
const REQUIRED = new Set(["title", "status", "priority", "stage", "health"]);

export function cellEditorFor(type: string, property: string): EditorKind | null {
  const byType = (CELL_EDITABLE as Record<string, Record<string, EditorKind>>)[type];
  return byType?.[property] ?? null;
}

export function isRequired(property: string): boolean {
  return REQUIRED.has(property);
}

/** The longest text a cell takes: titles are capped like the task form. */
export function maxLengthFor(property: string): number {
  return property === "title" ? 300 : 2000;
}

/** The most cells one paste may write; a full screen of a wide table is far less. */
export const PASTE_LIMIT = 500;

/** Tables that relation cells pick from, with the column that names a row. */
export const RELATION_SOURCES: Record<string, { table: string; label: string }> = {
  project: { table: "project", label: "name" },
  program: { table: "program", label: "name" },
  milestone: { table: "milestone", label: "name" },
  meeting: { table: "meeting", label: "title" },
};

export interface CellOption {
  id: string;
  label: string;
}

export type CellError =
  | "required"
  | "tooLong"
  | "number"
  | "date"
  | "choice"
  | "person"
  | "relation"
  | "checkbox"
  | "url"
  | "email";

/**
 * A typed value for one cell: `raw` is what the server action receives (a
 * string or null), `value` is what the table shows until the save returns.
 */
export type ParsedCell = { ok: true; raw: string | null; value: LensValue } | { ok: false; error: CellError };

export interface ParseContext {
  property: string;
  /** The person's language, for numbers. Omitted on the server. */
  locale?: string;
  choices?: CatalogChoice[];
  /** People or related records to match by id or name. Without it only an id is accepted. */
  options?: CellOption[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE_WORDS = new Set(["true", "yes", "oui", "vrai", "1", "x", "✓", "☑"]);
const FALSE_WORDS = new Set(["false", "no", "non", "faux", "0", ""]);

/** A real calendar date in YYYY-MM-DD, or null. */
export function isoDate(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

/**
 * A number as someone types it in their language. English: "1234.5" or
 * "1,234.5" (commas only between groups of three). French: "1234,5" or
 * "1 234,5", and a plain "1234.5" too. Without a language (on the server, which
 * receives the browser's canonical "1234.5") no comma is accepted. Anything
 * ambiguous or not a number is null, never a guess.
 */
export function parseNumber(text: string, locale?: string): number | null {
  const compact = text.replace(/[\s\u00a0\u202f]/g, "");
  let normal: string;
  if (locale?.startsWith("fr")) {
    if (compact.includes(",") && compact.includes(".")) return null;
    normal = compact.replace(",", ".");
  } else if (locale) {
    if (compact.includes(",") && !/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) return null;
    normal = compact.replace(/,/g, "");
  } else {
    normal = compact;
  }
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

const fold = (text: string) => text.trim().toLocaleLowerCase("fr-CA").normalize("NFC");

function matchChoice(text: string, choices: CatalogChoice[]): CatalogChoice | undefined {
  const wanted = fold(text);
  return (
    choices.find((c) => c.key === text) ??
    choices.find((c) => fold(c.key) === wanted || fold(c.label.en) === wanted || fold(c.label.fr) === wanted)
  );
}

function matchOption(text: string, options: CellOption[] | undefined): CellOption | null | undefined {
  if (UUID.test(text)) return options?.find((o) => o.id === text) ?? (options ? undefined : { id: text, label: text });
  if (!options) return undefined;
  const wanted = fold(text);
  return options.find((o) => fold(o.label) === wanted);
}

/**
 * Reads what someone typed or pasted into a cell of the given kind. The same
 * rules run in the browser (to refuse before saving, with a message) and on
 * the server (which never trusts the browser's answer).
 */
export function parseCellInput(kind: EditorKind, input: string | null, context: ParseContext): ParsedCell {
  const text = (input ?? "").trim();
  if (text === "" && kind !== "checkbox") {
    return isRequired(context.property) ? { ok: false, error: "required" } : { ok: true, raw: null, value: null };
  }
  switch (kind) {
    case "text":
      if (text.length > maxLengthFor(context.property)) return { ok: false, error: "tooLong" };
      return { ok: true, raw: text, value: text };
    case "url": {
      let url: URL;
      try {
        url = new URL(text);
      } catch {
        return { ok: false, error: "url" };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, error: "url" };
      if (text.length > maxLengthFor(context.property)) return { ok: false, error: "tooLong" };
      return { ok: true, raw: text, value: text };
    }
    case "email":
      if (!EMAIL.test(text) || text.length > 320) return { ok: false, error: "email" };
      return { ok: true, raw: text, value: text };
    case "number": {
      const value = parseNumber(text, context.locale);
      if (value === null) return { ok: false, error: "number" };
      return { ok: true, raw: String(value), value };
    }
    case "date": {
      const value = isoDate(text);
      if (!value) return { ok: false, error: "date" };
      return { ok: true, raw: value, value };
    }
    case "checkbox": {
      const word = fold(text);
      if (TRUE_WORDS.has(word)) return { ok: true, raw: "true", value: true };
      if (FALSE_WORDS.has(word)) return { ok: true, raw: "false", value: false };
      return { ok: false, error: "checkbox" };
    }
    case "select": {
      const choice = matchChoice(text, context.choices ?? []);
      if (!choice) return { ok: false, error: "choice" };
      return { ok: true, raw: choice.key, value: choice.key };
    }
    case "multi_select": {
      const keys: string[] = [];
      for (const part of text.split(/[,;\n]/).map((p) => p.trim()).filter(Boolean)) {
        const choice = matchChoice(part, context.choices ?? []);
        if (!choice) return { ok: false, error: "choice" };
        if (!keys.includes(choice.key)) keys.push(choice.key);
      }
      if (keys.length === 0) return isRequired(context.property) ? { ok: false, error: "required" } : { ok: true, raw: null, value: null };
      return { ok: true, raw: JSON.stringify(keys), value: keys.join(", ") };
    }
    case "person":
    case "relation": {
      const option = matchOption(text, context.options);
      if (!option) return { ok: false, error: kind };
      return { ok: true, raw: option.id, value: { id: option.id, label: option.label } };
    }
  }
}

/**
 * The value written to the record for a parsed cell's raw string: numbers as
 * numbers, checkboxes as booleans, multi-selects as a list of keys.
 */
export function storedValue(kind: EditorKind, raw: string | null): unknown {
  if (raw === null) return null;
  if (kind === "number") return Number(raw);
  if (kind === "checkbox") return raw === "true";
  if (kind === "multi_select") return JSON.parse(raw) as string[];
  return raw;
}
