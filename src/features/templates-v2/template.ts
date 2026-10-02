import type { EditorBlock } from "@/features/editor/adapter/content";
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

/** The values a page template can ask for when it is used. */
export const PAGE_VARIABLES = ["program", "owner", "period", "due"] as const;
export type PageVariableName = (typeof PAGE_VARIABLES)[number];
export type PageVariables = Partial<Record<PageVariableName, string>>;

/** A page as editor blocks in each language (T1): any block in the editor's registry. */
export interface PageDocument {
  en: EditorBlock[];
  fr: EditorBlock[];
}

export interface HubMilestone {
  title: LocalizedText;
  offsets?: Offsets;
}

export interface HubTask extends TaskItem {
  /** Index of the hub milestone the task belongs to. */
  milestone?: number;
}

/** What using a hub template creates besides the page: a project, its milestones and tasks (T1). */
export interface HubBody {
  milestones?: HubMilestone[];
  tasks?: HubTask[];
}

export interface PageBody {
  title: LocalizedText;
  blocks: PageBlock[];
  /** The `{{name}}` placeholders the blocks use; the form asks for each. */
  variables?: PageVariableName[];
  /** The page in the real editor's blocks, rendered after `blocks` (T1). */
  document?: PageDocument;
  hub?: HubBody;
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
  kind: "project" | "task" | "milestone" | "page" | "heading" | "paragraph" | "todo";
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

export interface DraftBlock {
  kind: PageBlock["kind"];
  en: string;
  fr: string;
  due: string;
}

export type BuildProblem = "name" | "tasks" | "taskText" | "offset" | "blocks" | "blockText";

/** Same shape as the document-template merge (src/features/documents/templates/merge.ts). */
const PLACEHOLDER = /\{\{\s*([a-z_.]+)\s*\}\}/g;

/** The page variables a text uses, in order of first use; unknown names are ignored. */
export function findPageVariables(text: string): PageVariableName[] {
  const names: PageVariableName[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] as PageVariableName;
    if ((PAGE_VARIABLES as readonly string[]).includes(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

/** One line of plain text: control characters cannot restructure the page. */
function cleanValue(value: string | undefined): string {
  return (value ?? "")
    .slice(0, 500)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

/** Fills {{program}}, {{owner}}, {{period}} and {{due}}; any other placeholder stays as written. */
export function renderPageText(text: string, variables: PageVariables): string {
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    (PAGE_VARIABLES as readonly string[]).includes(name) ? cleanValue(variables[name as PageVariableName]) : whole,
  );
}

export interface RenderedPage {
  title: string;
  blocks: EditorBlock[];
  /** The page as plain text, one block per line (editor_document.content_text). */
  text: string;
}

/**
 * What public.apply_page_template_v2 writes for a page template: the title
 * and blocks in the chosen language, variables filled, every offset dated
 * from `start` and written after the text. Pure, so the preview and the
 * database agree, and the unit test can pin the exact output.
 */
export function renderPageBody(body: PageBody, variables: PageVariables, start: string, locale = "en"): RenderedPage {
  const fr = locale === "fr-CA";
  const lines: string[] = [];
  const blocks = body.blocks.map((block): EditorBlock => {
    let text = renderPageText(pick(block.text, locale), variables);
    const dates: string[] = [];
    if (isCalendarDate(start) && block.offsets?.start !== undefined) {
      dates.push(`${fr ? "Débute le " : "Starts "}${addDays(start, block.offsets.start)}`);
    }
    if (isCalendarDate(start) && block.offsets?.due !== undefined) {
      dates.push(`${fr ? "Échéance le " : "Due "}${addDays(start, block.offsets.due)}`);
    }
    if (dates.length > 0) text = `${text} · ${dates.join(" · ")}`;
    lines.push(text);
    const type = block.kind === "heading" ? "heading" : block.kind === "todo" ? "checkListItem" : "paragraph";
    const props = block.kind === "heading" ? { level: 2 } : block.kind === "todo" ? { checked: false } : {};
    return { type, props, content: [{ type: "text", text, styles: {} }], children: [] };
  });
  return {
    title: renderPageText(pick(body.title, locale), variables).slice(0, 500),
    blocks,
    text: lines.join("\n"),
  };
}

/**
 * A page template from the builder's rows: a heading, paragraph or to-do per
 * row, each in both languages, with an optional due offset. The variables
 * list is whatever the rows mention.
 */
export function buildPageBody(
  title: LocalizedText,
  blocks: DraftBlock[],
): { ok: true; body: PageBody } | { ok: false; problem: BuildProblem } {
  if (!title.en.trim() || !title.fr.trim()) return { ok: false, problem: "name" };
  const items: PageBlock[] = [];
  for (const b of blocks) {
    if (!b.en.trim() && !b.fr.trim() && !b.due.trim()) continue;
    if (!b.en.trim() || !b.fr.trim()) return { ok: false, problem: "blockText" };
    const due = b.due.trim();
    if (due && !(/^\d{1,4}$/.test(due) && Number(due) <= MAX_OFFSET)) return { ok: false, problem: "offset" };
    items.push({
      kind: b.kind,
      text: { en: b.en.trim(), fr: b.fr.trim() },
      ...(due ? { offsets: { due: Number(due) } } : {}),
    });
  }
  if (items.length === 0) return { ok: false, problem: "blocks" };
  const used = findPageVariables(
    [title.en, title.fr, ...items.flatMap((i) => [i.text.en, i.text.fr])].join("\n"),
  );
  return {
    ok: true,
    body: {
      title: { en: title.en.trim(), fr: title.fr.trim() },
      blocks: items,
      ...(used.length > 0 ? { variables: used } : {}),
    },
  };
}

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

// ---------------------------------------------------------------------------
// Documents and hubs (T1, migration 20261110010000)
// ---------------------------------------------------------------------------

/**
 * In a document, the four variables and date tokens: `{{start+N}}` is the
 * start date plus N days. Same shape as the database's pattern.
 */
const DOCUMENT_PLACEHOLDER = /\{\{\s*(program|owner|period|due|start\s*\+\s*[0-9]{1,4})\s*\}\}/g;

/** Fills one string of a document in one pass: a value is never scanned again. */
export function renderDocumentText(text: string, variables: PageVariables, start: string): string {
  return text.replace(DOCUMENT_PLACEHOLDER, (_whole, name: string) => {
    if (name.startsWith("start")) return addDays(start, Number(name.replace(/[^0-9]/g, "")));
    return cleanValue(variables[name as PageVariableName]);
  });
}

function renderValue(value: unknown, variables: PageVariables, start: string): unknown {
  if (typeof value === "string") return renderDocumentText(value, variables, start);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, variables, start));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderValue(item, variables, start)]));
  }
  return value;
}

/** A document's blocks in the chosen language, every string filled (public.apply_page_template_v2 does the same). */
export function renderDocument(document: PageDocument, variables: PageVariables, start: string, locale: string): EditorBlock[] {
  const blocks = locale === "fr-CA" ? document.fr : document.en;
  if (!isCalendarDate(start)) return blocks;
  return renderValue(blocks, variables, start) as EditorBlock[];
}

/** The page a template makes, as editor blocks: its rows, then its document. The hub's view is added on use. */
export function renderTemplateDocument(body: PageBody, variables: PageVariables, start: string, locale = "en"): EditorBlock[] {
  const rows = renderPageBody({ ...body, document: undefined }, variables, start, locale).blocks;
  return body.document ? [...rows, ...renderDocument(body.document, variables, start, locale)] : rows;
}

/** The variables a document uses anywhere, in order of first use. */
export function documentVariables(document: PageDocument): PageVariableName[] {
  return findPageVariables(JSON.stringify(document));
}

/**
 * The old rows as editor blocks in both languages, for editing a template in
 * the real editor. A row's dates become date tokens after its text, so the
 * page it makes says exactly what the row made it say.
 */
export function rowsToDocument(blocks: PageBlock[]): PageDocument {
  const convert = (lang: "en" | "fr"): EditorBlock[] =>
    blocks.map((block) => {
      const dates: string[] = [];
      if (block.offsets?.start !== undefined) dates.push(`${lang === "fr" ? "Débute le " : "Starts "}{{start+${block.offsets.start}}}`);
      if (block.offsets?.due !== undefined) dates.push(`${lang === "fr" ? "Échéance le " : "Due "}{{start+${block.offsets.due}}}`);
      const text = dates.length > 0 ? `${block.text[lang]} · ${dates.join(" · ")}` : block.text[lang];
      const type = block.kind === "heading" ? "heading" : block.kind === "todo" ? "checkListItem" : "paragraph";
      const props = block.kind === "heading" ? { level: 2 } : block.kind === "todo" ? { checked: false } : {};
      return { type, props, content: [{ type: "text", text, styles: {} }], children: [] };
    });
  return { en: convert("en"), fr: convert("fr") };
}

/** The document a template is edited as: its document, after its rows converted. */
export function editableDocument(body: PageBody): PageDocument {
  const rows = rowsToDocument(body.blocks ?? []);
  return {
    en: [...rows.en, ...(body.document?.en ?? [])],
    fr: [...rows.fr, ...(body.document?.fr ?? [])],
  };
}

/** What a hub creates on `start`, in order: the project, then its milestones and tasks. */
export function planHub(hub: HubBody, title: string, start: string, locale: string): PlannedItem[] {
  if (!isCalendarDate(start)) return [];
  const offsets = [...(hub.milestones ?? []), ...(hub.tasks ?? [])].flatMap((item) =>
    item.offsets?.due === undefined ? [] : [item.offsets.due],
  );
  return [
    {
      kind: "project",
      title,
      depth: 0,
      start,
      due: offsets.length > 0 ? addDays(start, Math.max(...offsets)) : null,
    },
    ...(hub.milestones ?? []).map(
      (m): PlannedItem => ({ kind: "milestone", title: pick(m.title, locale), depth: 1, ...dates(start, m.offsets) }),
    ),
    ...taskLines(hub.tasks, start, locale, 1),
  ];
}

export interface DraftMilestone {
  en: string;
  fr: string;
  due: string;
  /** Kept as stored; the editor shows only the due day. */
  start?: number;
}

export interface DraftHubTask {
  en: string;
  fr: string;
  due: string;
  /** The milestone's row number (1-based) as shown, or "" for none. */
  milestone: string;
  /** Kept as stored; the editor shows only titles, due day and milestone. */
  start?: number;
  priority?: Priority;
  description?: LocalizedText;
}

export type HubProblem = "hubText" | "offset" | "hubMilestone";

/**
 * A hub from the editor's rows; blank rows are skipped, and no rows means no
 * hub. A task's milestone is the row number on screen, blank rows counted.
 */
export function buildHub(
  milestones: DraftMilestone[],
  tasks: DraftHubTask[],
): { ok: true; hub: HubBody | null } | { ok: false; problem: HubProblem } {
  const offset = (raw: string): number | undefined | null => {
    const value = raw.trim();
    if (!value) return undefined;
    if (!/^\d{1,4}$/.test(value) || Number(value) > MAX_OFFSET) return null;
    return Number(value);
  };
  const offsets = (start: number | undefined, due: number | undefined): { offsets?: Offsets } | null => {
    if (start !== undefined && (!Number.isInteger(start) || start < 0 || start > MAX_OFFSET)) return null;
    if (start !== undefined && due !== undefined && start > due) return null;
    if (start === undefined && due === undefined) return {};
    return { offsets: { ...(start === undefined ? {} : { start }), ...(due === undefined ? {} : { due }) } };
  };
  const blank = (row: { en: string; fr: string; due: string }) => !row.en.trim() && !row.fr.trim() && !row.due.trim();
  const out: HubBody = { milestones: [], tasks: [] };
  /** Screen row (1-based) to the kept milestone's index. */
  const kept = new Map<number, number>();
  for (const [index, m] of milestones.entries()) {
    if (blank(m)) continue;
    if (!m.en.trim() || !m.fr.trim()) return { ok: false, problem: "hubText" };
    const dates = offsets(m.start, offset(m.due) ?? undefined);
    if (offset(m.due) === null || dates === null) return { ok: false, problem: "offset" };
    kept.set(index + 1, out.milestones!.length);
    out.milestones!.push({ title: { en: m.en.trim(), fr: m.fr.trim() }, ...dates });
  }
  for (const t of tasks) {
    if (blank(t) && !t.milestone.trim()) continue;
    if (!t.en.trim() || !t.fr.trim()) return { ok: false, problem: "hubText" };
    const dates = offsets(t.start, offset(t.due) ?? undefined);
    if (offset(t.due) === null || dates === null) return { ok: false, problem: "offset" };
    let milestone: number | undefined;
    if (t.milestone.trim()) {
      const row = Number(t.milestone.trim());
      if (!Number.isInteger(row) || !kept.has(row)) return { ok: false, problem: "hubMilestone" };
      milestone = kept.get(row);
    }
    out.tasks!.push({
      title: { en: t.en.trim(), fr: t.fr.trim() },
      ...(t.description ? { description: t.description } : {}),
      ...(t.priority ? { priority: t.priority } : {}),
      ...dates,
      ...(milestone === undefined ? {} : { milestone }),
    });
  }
  if (out.milestones!.length + out.tasks!.length === 0) return { ok: true, hub: null };
  return { ok: true, hub: out };
}

/** A hub as the editor's rows, for editing; what the rows do not show is kept. */
export function hubToDrafts(hub: HubBody | undefined): { milestones: DraftMilestone[]; tasks: DraftHubTask[] } {
  return {
    milestones: (hub?.milestones ?? []).map((m) => ({
      en: m.title.en,
      fr: m.title.fr,
      due: m.offsets?.due === undefined ? "" : String(m.offsets.due),
      ...(m.offsets?.start === undefined ? {} : { start: m.offsets.start }),
    })),
    tasks: (hub?.tasks ?? []).map((t) => ({
      en: t.title.en,
      fr: t.title.fr,
      due: t.offsets?.due === undefined ? "" : String(t.offsets.due),
      milestone: t.milestone === undefined ? "" : String(t.milestone + 1),
      ...(t.offsets?.start === undefined ? {} : { start: t.offsets.start }),
      ...(t.priority ? { priority: t.priority } : {}),
      ...(t.description ? { description: t.description } : {}),
    })),
  };
}
