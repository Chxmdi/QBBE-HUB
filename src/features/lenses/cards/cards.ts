import type { LensCatalog } from "@/lib/query/catalog";
import type { LensSpec } from "@/lib/query/spec";

/** The facts a card shows when a lens does not choose its own. */
export const DEFAULT_FACTS: Record<string, string[]> = {
  task: ["status", "priority", "due", "assignee", "project"],
  project: ["stage", "health", "target", "owner", "program"],
};

/** Where a record opens. */
export function recordHref(type: string, id: string): string {
  if (type === "task") return `/my-work?task=${id}`;
  if (type === "project") return `/projects/${id}`;
  return `/lenses/table?type=${type}`;
}

/** The facts to show: the lens's columns that exist and can be shown, else the defaults. */
export function factsFor(catalog: LensCatalog, type: string, select: string[] | undefined): string[] {
  const props = catalog[type]?.properties ?? [];
  const usable = (k: string) => props.some((p) => p.key === k && !p.filterOnly) && k !== "title";
  const chosen = (select ?? []).filter(usable);
  return (chosen.length ? chosen : (DEFAULT_FACTS[type] ?? []).filter(usable)).slice(0, 5);
}

/** The spec a gallery or feed asks for: the lens's conditions, its facts, and the view's order. */
export function viewSpec(
  base: Partial<LensSpec> & { type: string },
  facts: string[],
  order: "lens" | "recent",
  limit: number,
  offset = 0,
): LensSpec {
  const recent = order === "recent";
  return {
    version: 1,
    type: base.type,
    ...(base.where ? { where: base.where } : {}),
    sort: recent ? [{ property: "edited_time", direction: "desc" }] : (base.sort?.length ? base.sort : [{ property: "title", direction: "asc" }]),
    select: [...new Set([...facts, ...(recent ? ["edited_time", "created_time"] : [])])].slice(0, 30),
    limit,
    offset,
  };
}

/** Rows grouped by the calendar day of a timestamp, in the viewer's zone, keeping their order. */
export function groupByDay<T>(items: T[], at: (item: T) => string | null, timeZone: string): { day: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const iso = at(item);
    const day = iso ? fmt.format(new Date(iso)) : "";
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
