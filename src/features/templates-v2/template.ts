import type { LocalizedText } from "@/lib/objects/contracts";

/**
 * Templates for objects, pages and spaces (V1-13). The body shapes match the
 * checks in migration 20261106110200 (app.template_v2_body_problem); every
 * date is a whole number of days after the start date chosen on use.
 */

export type TemplateScope = "object" | "page" | "space";
export type TemplateTypeKey = "task" | "project";
export type Priority = "low" | "medium" | "high" | "critical";

export interface Offsets {
  start?: number;
  due?: number;
}

export interface TaskItem {
  title: LocalizedText;
  description?: LocalizedText;
  priority?: Priority;
  offsets?: Offsets;
}

export interface ProjectItem {
  title: LocalizedText;
  description?: LocalizedText;
  offsets?: Offsets;
  tasks?: TaskItem[];
}

export interface PageBlock {
  kind: "heading" | "paragraph" | "todo";
  text: LocalizedText;
  offsets?: Offsets;
}

export interface PageBody {
  title: LocalizedText;
  blocks: PageBlock[];
}

export interface SpaceBody {
  title: LocalizedText;
  projects: ProjectItem[];
}

export type TemplateBody = TaskItem | ProjectItem | PageBody | SpaceBody;

export interface TemplateRecord {
  id: string;
  scope: TemplateScope;
  typeKey: TemplateTypeKey | null;
  body: TemplateBody;
}

/** One line of the preview: what will be created, in the chosen language, with real dates. */
export interface PlannedItem {
  kind: "project" | "task" | "page" | "heading" | "paragraph" | "todo";
  title: string;
  depth: number;
  start: string | null;
  due: string | null;
}

const MAX_OFFSET = 3650;

/** YYYY-MM-DD plus whole days, in calendar terms (no time zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function pick(text: LocalizedText | undefined, locale: string): string {
  if (!text) return "";
  return locale === "fr-CA" ? text.fr : text.en;
}

function dates(start: string, offsets: Offsets | undefined) {
  return {
    start: offsets?.start === undefined ? null : addDays(start, offsets.start),
    due: offsets?.due === undefined ? null : addDays(start, offsets.due),
  };
}

function taskLines(tasks: TaskItem[] | undefined, start: string, locale: string, depth: number): PlannedItem[] {
  return (tasks ?? []).map((t) => ({ kind: "task", title: pick(t.title, locale), depth, ...dates(start, t.offsets) }));
}

function projectLines(project: ProjectItem, start: string, locale: string): PlannedItem[] {
  return [
    { kind: "project", title: pick(project.title, locale), depth: 0, ...dates(start, project.offsets) },
    ...taskLines(project.tasks, start, locale, 1),
  ];
}

/** What using the template on `start` would create, in order. The database does the same arithmetic. */
export function planTemplate(template: TemplateRecord, start: string, locale: string): PlannedItem[] {
  if (!isCalendarDate(start)) return [];
  if (template.scope === "object" && template.typeKey === "task") {
    return taskLines([template.body as TaskItem], start, locale, 0);
  }
  if (template.scope === "object") return projectLines(template.body as ProjectItem, start, locale);
  if (template.scope === "space") {
    return (template.body as SpaceBody).projects.flatMap((p) => projectLines(p, start, locale));
  }
  const page = template.body as PageBody;
  return [
    { kind: "page", title: pick(page.title, locale), depth: 0, start: null, due: null },
    ...page.blocks.map((b) => ({ kind: b.kind, title: pick(b.text, locale), depth: 1, ...dates(start, b.offsets) })),
  ];
}

/** Where using the template puts things: a program for projects and spaces, a project for a task. */
export function destinationFor(template: Pick<TemplateRecord, "scope" | "typeKey">): "program" | "project" | "none" {
  if (template.scope === "page") return "none";
  if (template.scope === "object" && template.typeKey === "task") return "project";
  return "program";
}

export interface DraftTask {
  en: string;
  fr: string;
  due: string;
}

export type BuildProblem = "name" | "tasks" | "taskText" | "offset";

/**
 * A project template from the builder's rows, or a task template from one row.
 * Offsets are typed as day counts; blank means no date.
 */
export function buildBody(
  typeKey: TemplateTypeKey,
  title: LocalizedText,
  duration: string,
  tasks: DraftTask[],
): { ok: true; body: TaskItem | ProjectItem } | { ok: false; problem: BuildProblem } {
  if (!title.en.trim() || !title.fr.trim()) return { ok: false, problem: "name" };
  const offset = (raw: string): number | undefined | null => {
    if (!raw.trim()) return undefined;
    if (!/^\d{1,4}$/.test(raw.trim())) return null;
    const n = Number(raw.trim());
    return n <= MAX_OFFSET ? n : null;
  };
  const items: TaskItem[] = [];
  for (const t of tasks) {
    if (!t.en.trim() && !t.fr.trim() && !t.due.trim()) continue;
    if (!t.en.trim() || !t.fr.trim()) return { ok: false, problem: "taskText" };
    const due = offset(t.due);
    if (due === null) return { ok: false, problem: "offset" };
    items.push({ title: { en: t.en.trim(), fr: t.fr.trim() }, ...(due === undefined ? {} : { offsets: { due } }) });
  }
  const end = offset(duration);
  if (end === null) return { ok: false, problem: "offset" };
  const trimmed = { en: title.en.trim(), fr: title.fr.trim() };
  if (typeKey === "task") {
    return { ok: true, body: { title: trimmed, ...(end === undefined ? {} : { offsets: { due: end } }) } };
  }
  if (items.length === 0) return { ok: false, problem: "tasks" };
  return {
    ok: true,
    body: { title: trimmed, offsets: { start: 0, ...(end === undefined ? {} : { due: end }) }, tasks: items },
  };
}
