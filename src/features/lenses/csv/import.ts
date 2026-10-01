import type { LocalizedText } from "@/lib/objects/contracts";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { importableProperties, MAX_LENGTH, mappingProblems, normalizeLabel, REQUIRED, type ColumnMapping, type ImportTypeKey } from "./mapping";

/**
 * Row validation for a CSV import (Workspace OS U15). Pure and shared: the
 * wizard previews with it in the browser and the route runs it again on the
 * server before anything is created, so the preview is the truth.
 *
 * Each cell is read by the property's kind. A row with any refused cell is
 * skipped whole and reported with a reason in both languages; the rest of
 * the file still imports. People and related records are named, never
 * numbered: a person by exact name or email, a project or program by exact
 * name, case and accents ignored.
 */

export interface ImportRefs {
  people: { id: string; name: string; email: string }[];
  projects: { id: string; name: string }[];
  programs: { id: string; name: string }[];
  milestones: { id: string; name: string; projectId: string | null }[];
}

export interface RowError {
  /** 1-based data row (the header is not counted); 0 for a problem with the file. */
  row: number;
  column: string | null;
  message: LocalizedText;
}

export interface ValidatedRow {
  row: number;
  /** Property key to resolved value: ids for people and relations, YYYY-MM-DD for dates. */
  values: Record<string, unknown>;
}

export interface Validation {
  rows: ValidatedRow[];
  errors: RowError[];
  /** Rows the file had, blank ones excluded. */
  total: number;
}

// ---------------------------------------------------------------------------
// Cell readers
// ---------------------------------------------------------------------------

function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * YYYY-MM-DD (ISO, what the export writes) or DD/MM/YYYY (what Quebec writes
 * by hand), with - / . as separators and single-digit days and months
 * accepted. A time after the date is ignored. Anything else is refused:
 * guessing between 03/04 and 04/03 would silently file work on the wrong day.
 */
export function parseImportDate(text: string): string | null {
  const value = text.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(value);
  if (m) return realDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T ].*)?$/.exec(value);
  if (m) return realDate(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/** "1 234,5" (French), "1,234.5" (English), "12.5", "12,5"; "1,234" is ambiguous and refused. */
export function parseImportNumber(text: string): number | null {
  let value = text.trim().replace(/[\s  ]/g, "");
  if (value === "") return null;
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    // The later one is the decimal mark; the other separates thousands.
    value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (comma >= 0) {
    // "12,5" is a French decimal; "1,234" could be either reading, so it is
    // refused rather than guessed (one of them is a thousand times wrong).
    if (value.indexOf(",") !== comma || /,\d{3}$/.test(value)) return null;
    value = value.replace(",", ".");
  }
  if (!/^[-+]?\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const TRUE = new Set(["true", "yes", "oui", "y", "o", "1", "x", "✓", "vrai"]);
const FALSE = new Set(["false", "no", "non", "n", "0", "faux"]);

export function parseImportBoolean(text: string): boolean | null {
  const v = normalizeLabel(text);
  if (TRUE.has(v) || text.trim() === "✓") return true;
  if (FALSE.has(v)) return false;
  return null;
}

export type Resolved = { id: string } | { problem: "unknown" | "ambiguous" };

/** Exact name or email, case and accents ignored; several people with the name is a refusal. */
export function resolvePerson(text: string, people: ImportRefs["people"]): Resolved {
  const wanted = normalizeLabel(text);
  const email = text.trim().toLowerCase();
  const byEmail = people.filter((p) => p.email.trim().toLowerCase() === email && email !== "");
  if (byEmail.length === 1) return { id: byEmail[0].id };
  const byName = people.filter((p) => normalizeLabel(p.name) === wanted && wanted !== "");
  if (byName.length === 1) return { id: byName[0].id };
  return { problem: byName.length > 1 ? "ambiguous" : "unknown" };
}

export function resolveByName(text: string, items: { id: string; name: string }[]): Resolved {
  const wanted = normalizeLabel(text);
  const found = items.filter((i) => normalizeLabel(i.name) === wanted && wanted !== "");
  if (found.length === 1) return { id: found[0].id };
  return { problem: found.length > 1 ? "ambiguous" : "unknown" };
}

export function resolveChoice(text: string, property: CatalogProperty): string | null {
  const wanted = normalizeLabel(text);
  const choice = property.choices?.find(
    (c) => normalizeLabel(c.key) === wanted || normalizeLabel(c.label.en) === wanted || normalizeLabel(c.label.fr) === wanted,
  );
  return choice?.key ?? null;
}

// ---------------------------------------------------------------------------
// Messages, in both languages, with the property's name in each
// ---------------------------------------------------------------------------

type Vars = { value?: string; max?: number; choices?: { en: string; fr: string }; target?: LocalizedText };

const TARGET_NAMES: Record<string, LocalizedText> = {
  project: { en: "project", fr: "projet" },
  program: { en: "program", fr: "programme" },
  milestone: { en: "milestone", fr: "jalon" },
};

function message(code: string, name: LocalizedText, v: Vars = {}): LocalizedText {
  const value = v.value ?? "";
  switch (code) {
    case "required":
      return { en: `${name.en} is required.`, fr: `${name.fr} est obligatoire.` };
    case "tooLong":
      return { en: `${name.en} is longer than ${v.max} characters.`, fr: `${name.fr} dépasse ${v.max} caractères.` };
    case "badDate":
      return {
        en: `${name.en}: “${value}” is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`,
        fr: `${name.fr} : « ${value} » n’est pas une date. Utilisez AAAA-MM-JJ ou JJ/MM/AAAA.`,
      };
    case "badNumber":
      return { en: `${name.en}: “${value}” is not a number.`, fr: `${name.fr} : « ${value} » n’est pas un nombre.` };
    case "badBoolean":
      return { en: `${name.en}: “${value}” must be yes or no.`, fr: `${name.fr} : « ${value} » doit être oui ou non.` };
    case "badChoice":
      return {
        en: `${name.en}: “${value}” is not one of ${v.choices?.en}.`,
        fr: `${name.fr} : « ${value} » n’est pas parmi ${v.choices?.fr}.`,
      };
    case "unknownPerson":
      return {
        en: `${name.en}: nobody is named “${value}”. Use the exact name or the email address.`,
        fr: `${name.fr} : personne ne s’appelle « ${value} ». Utilisez le nom exact ou l’adresse courriel.`,
      };
    case "ambiguousPerson":
      return {
        en: `${name.en}: several people are named “${value}”. Use the email address.`,
        fr: `${name.fr} : plusieurs personnes s’appellent « ${value} ». Utilisez l’adresse courriel.`,
      };
    case "unknownRef":
      return {
        en: `${name.en}: no ${v.target?.en} is named “${value}”.`,
        fr: `${name.fr} : aucun ${v.target?.fr} ne s’appelle « ${value} ».`,
      };
    case "ambiguousRef":
      return {
        en: `${name.en}: several ${v.target?.en}s are named “${value}”.`,
        fr: `${name.fr} : plusieurs ${v.target?.fr}s s’appellent « ${value} ».`,
      };
    case "milestoneProject":
      return {
        en: `${name.en}: that milestone belongs to another project.`,
        fr: `${name.fr} : ce jalon appartient à un autre projet.`,
      };
    default:
      return { en: `${name.en}: invalid value.`, fr: `${name.fr} : valeur invalide.` };
  }
}

export const FILE_MESSAGES = {
  noTitle: { en: "Map a column to the title.", fr: "Associez une colonne au titre." },
  duplicated: (names: LocalizedText[]): LocalizedText => ({
    en: `More than one column is mapped to ${names.map((n) => n.en).join(", ")}.`,
    fr: `Plusieurs colonnes sont associées à ${names.map((n) => n.fr).join(", ")}.`,
  }),
  tooManyRows: (max: number): LocalizedText => ({
    en: `A file imports at most ${max} rows. Split it and import the parts.`,
    fr: `Un fichier importe au plus ${max} lignes. Divisez-le et importez les parties.`,
  }),
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function readCell(
  property: CatalogProperty,
  text: string,
  refs: ImportRefs,
): { value: unknown } | { error: LocalizedText } {
  const name = property.name;
  switch (property.kind) {
    case "text": {
      const max = MAX_LENGTH[property.key] ?? 5000;
      if (text.length > max) return { error: message("tooLong", name, { max }) };
      return { value: text };
    }
    case "date": {
      const date = parseImportDate(text);
      return date ? { value: date } : { error: message("badDate", name, { value: text }) };
    }
    case "number": {
      const n = parseImportNumber(text);
      return n === null ? { error: message("badNumber", name, { value: text }) } : { value: n };
    }
    case "checkbox": {
      const b = parseImportBoolean(text);
      return b === null ? { error: message("badBoolean", name, { value: text }) } : { value: b };
    }
    case "person": {
      const r = resolvePerson(text, refs.people);
      if ("id" in r) return { value: r.id };
      return { error: message(r.problem === "ambiguous" ? "ambiguousPerson" : "unknownPerson", name, { value: text }) };
    }
    case "relation":
    case "select": {
      if (property.choices) {
        const key = resolveChoice(text, property);
        if (key) return { value: key };
        return {
          error: message("badChoice", name, {
            value: text,
            choices: {
              en: property.choices.map((c) => c.label.en).join(", "),
              fr: property.choices.map((c) => c.label.fr).join(", "),
            },
          }),
        };
      }
      const targetKey = property.target ?? property.ref?.table ?? property.key;
      const items =
        targetKey === "project" ? refs.projects : targetKey === "program" ? refs.programs : targetKey === "milestone" ? refs.milestones : [];
      const r = resolveByName(text, items);
      if ("id" in r) return { value: r.id };
      const target = TARGET_NAMES[targetKey] ?? { en: "record", fr: "élément" };
      return { error: message(r.problem === "ambiguous" ? "ambiguousRef" : "unknownRef", name, { value: text, target }) };
    }
    default:
      return { value: text };
  }
}

export function validateRows(input: {
  type: CatalogType;
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
  refs: ImportRefs;
}): Validation {
  const typeKey = input.type.key as ImportTypeKey;
  const properties = importableProperties(input.type);
  const byKey = new Map(properties.map((p) => [p.key, p]));
  const errors: RowError[] = [];

  const problems = mappingProblems(input.mapping, typeKey);
  if (problems.missing.length > 0) errors.push({ row: 0, column: null, message: FILE_MESSAGES.noTitle });
  if (problems.duplicated.length > 0) {
    errors.push({
      row: 0,
      column: null,
      message: FILE_MESSAGES.duplicated(problems.duplicated.map((k) => byKey.get(k)?.name ?? { en: k, fr: k })),
    });
  }
  if (errors.length > 0) return { rows: [], errors, total: input.rows.length };

  const columns = input.headers
    .map((header, index) => ({ header, index, property: input.mapping[header] ? byKey.get(input.mapping[header]!) : undefined }))
    .filter((c): c is { header: string; index: number; property: CatalogProperty } => c.property !== undefined);

  // Milestones are read last, among the row's own project's milestones, so
  // two projects can each have a "Kickoff".
  const ordered = [...columns].sort((a, b) => Number(a.property.key === "milestone") - Number(b.property.key === "milestone"));
  const rows: ValidatedRow[] = [];
  input.rows.forEach((cells, i) => {
    const row = i + 1;
    const values: Record<string, unknown> = {};
    let failed = false;
    for (const column of ordered) {
      const text = (cells[column.index] ?? "").trim();
      if (text === "") continue;
      const refs =
        column.property.key === "milestone" && typeof values.project === "string"
          ? { ...input.refs, milestones: input.refs.milestones.filter((m) => m.projectId === values.project) }
          : input.refs;
      const read = readCell(column.property, text, refs);
      if ("error" in read) {
        errors.push({ row, column: column.header, message: read.error });
        failed = true;
      } else {
        values[column.property.key] = read.value;
      }
    }
    for (const key of REQUIRED[typeKey]) {
      if (values[key] === undefined || values[key] === "") {
        const property = byKey.get(key);
        errors.push({ row, column: columns.find((c) => c.property.key === key)?.header ?? null, message: message("required", property?.name ?? { en: key, fr: key }) });
        failed = true;
      }
    }
    if (typeof values.milestone === "string" && typeof values.project === "string") {
      const milestone = input.refs.milestones.find((m) => m.id === values.milestone);
      if (milestone && milestone.projectId && milestone.projectId !== values.project) {
        errors.push({ row, column: columns.find((c) => c.property.key === "milestone")?.header ?? null, message: message("milestoneProject", byKey.get("milestone")!.name) });
        failed = true;
      }
    }
    if (!failed) rows.push({ row, values });
  });

  return { rows, errors, total: input.rows.length };
}

/** The create command's input for one validated row. */
export function toCreateInput(typeKey: ImportTypeKey, values: Record<string, unknown>): Record<string, unknown> {
  const s = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : undefined);
  if (typeKey === "task") {
    const projectId = s("project");
    return {
      title: s("title"),
      description: s("description"),
      status: s("status"),
      priority: s("priority"),
      assigneeId: s("assignee"),
      reviewerId: s("reviewer"),
      approverId: s("approver"),
      dueAt: s("due"),
      projectId,
      programId: projectId ? undefined : s("program"),
      milestoneId: s("milestone"),
      source: { type: "manual", id: null },
    };
  }
  return {
    name: s("title"),
    outcome: s("outcome"),
    stage: s("stage"),
    health: s("health"),
    priority: s("priority"),
    ownerId: s("owner"),
    programId: s("program"),
    startDate: s("start"),
    targetDate: s("target"),
  };
}
