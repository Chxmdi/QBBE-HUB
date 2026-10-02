import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";

/**
 * Header-to-property mapping for a CSV import (Workspace OS U15).
 *
 * Only properties the type's create command accepts can be filled, so the
 * import never writes a column the screens could not; the list is fixed here
 * rather than read from the catalog, which also lists read-only values such
 * as "created by". Suggestions match a header to a property by its key, its
 * English or French name, or a common alias, accents and case ignored.
 */

export type ImportTypeKey = "task" | "project";
export const IMPORT_TYPES: readonly ImportTypeKey[] = ["task", "project"];

export function isImportType(key: string): key is ImportTypeKey {
  return (IMPORT_TYPES as readonly string[]).includes(key);
}

const IMPORTABLE: Record<ImportTypeKey, string[]> = {
  task: ["title", "description", "status", "priority", "assignee", "reviewer", "approver", "due", "project", "program", "milestone"],
  project: ["title", "outcome", "stage", "health", "priority", "owner", "program", "start", "target"],
};

/** Text the create commands take that the lens catalog does not show. */
const EXTRA: Record<ImportTypeKey, CatalogProperty[]> = {
  task: [
    { key: "description", kind: "text", propertyKind: "text", name: { en: "Description", fr: "Description" }, sortable: false, groupable: false },
  ],
  project: [
    { key: "outcome", kind: "text", propertyKind: "text", name: { en: "Outcome", fr: "Résultat visé" }, sortable: false, groupable: false },
  ],
};

export const REQUIRED: Record<ImportTypeKey, readonly string[]> = { task: ["title"], project: ["title"] };

/** Longest text each property accepts; the create commands refuse more. */
export const MAX_LENGTH: Record<string, number> = {
  title: 200,
  description: 5000,
  outcome: 2000,
};

/**
 * Options the create commands refuse: a task cannot start blocked without a
 * reason, and a project is created in one of its first four stages.
 */
const EXCLUDED_CHOICES: Record<ImportTypeKey, Record<string, string[]>> = {
  task: { status: ["blocked"] },
  project: { stage: ["paused", "completed", "cancelled", "archived"] },
};

/** The properties a file may fill for this type, in a sensible order. */
export function importableProperties(type: CatalogType): CatalogProperty[] {
  if (!isImportType(type.key)) return [];
  const typeKey = type.key;
  const all = [...type.properties, ...EXTRA[typeKey]];
  return IMPORTABLE[typeKey]
    .map((key) => all.find((p) => p.key === key))
    .filter((p): p is CatalogProperty => p !== undefined && !p.filterOnly)
    .map((p) => {
      const excluded = EXCLUDED_CHOICES[typeKey][p.key];
      return excluded && p.choices ? { ...p, choices: p.choices.filter((c) => !excluded.includes(c.key)) } : p;
    });
}

/** Header name to property key; null means the column is skipped. */
export type ColumnMapping = Record<string, string | null>;

/** Lower case, no accents, one space between words. */
export function normalizeLabel(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES: Record<string, string[]> = {
  title: ["title", "name", "task", "tache", "nom", "titre", "project", "projet", "project name", "nom du projet", "subject", "sujet"],
  description: ["description", "details", "detail", "notes", "note", "body"],
  status: ["status", "statut", "etat", "state"],
  priority: ["priority", "priorite"],
  assignee: ["assignee", "assigned to", "assigned", "responsable", "assigne", "assigne a", "owner"],
  reviewer: ["reviewer", "reviseur", "review"],
  approver: ["approver", "approbateur", "approval"],
  due: ["due", "due date", "due on", "deadline", "echeance", "date d echeance", "date limite"],
  project: ["project", "projet"],
  program: ["program", "programme"],
  milestone: ["milestone", "jalon"],
  outcome: ["outcome", "resultat", "resultat vise", "objective", "objectif"],
  stage: ["stage", "etape", "phase"],
  health: ["health", "sante", "etat de sante"],
  owner: ["owner", "proprietaire", "responsable", "lead", "project owner"],
  start: ["start", "start date", "debut", "date de debut", "starts"],
  target: ["target", "target date", "date cible", "end", "end date", "fin", "date de fin"],
};

function matches(property: CatalogProperty, header: string): boolean {
  const h = normalizeLabel(header);
  if (h === "") return false;
  if (h === normalizeLabel(property.key)) return true;
  if (h === normalizeLabel(property.name.en) || h === normalizeLabel(property.name.fr)) return true;
  return (ALIASES[property.key] ?? []).includes(h);
}

/**
 * A first mapping for the person to correct: exact matches on the key or
 * name first, then aliases. Each property is taken by one header only; the
 * title is matched before the rest so "Project" on a project file is its
 * name, not a relation.
 */
export function suggestMapping(headers: string[], properties: CatalogProperty[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const taken = new Set<string>();
  const claim = (header: string, property: CatalogProperty) => {
    mapping[header] = property.key;
    taken.add(property.key);
  };
  for (const header of headers) mapping[header] = null;
  // Pass 1: the exact key or name.
  for (const header of headers) {
    const h = normalizeLabel(header);
    const exact = properties.find(
      (p) => !taken.has(p.key) && (h === normalizeLabel(p.key) || h === normalizeLabel(p.name.en) || h === normalizeLabel(p.name.fr)),
    );
    if (exact) claim(header, exact);
  }
  // Pass 2: aliases, the title first.
  const ordered = [...properties].sort((a, b) => (a.key === "title" ? -1 : b.key === "title" ? 1 : 0));
  for (const header of headers) {
    if (mapping[header]) continue;
    const alias = ordered.find((p) => !taken.has(p.key) && matches(p, header));
    if (alias) claim(header, alias);
  }
  return mapping;
}

export interface MappingProblems {
  /** Required properties no column fills. */
  missing: string[];
  /** Properties two or more columns fill. */
  duplicated: string[];
}

export function mappingProblems(mapping: ColumnMapping, typeKey: ImportTypeKey): MappingProblems {
  const counts = new Map<string, number>();
  for (const key of Object.values(mapping)) {
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    missing: REQUIRED[typeKey].filter((key) => !counts.has(key)),
    duplicated: [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key),
  };
}
