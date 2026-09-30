import type { LensCatalog } from "@/lib/query/catalog";
import type { LensNode, LensSpec } from "@/lib/query/spec";
import type { DashboardFilters } from "./schema";

/** The person and date property each type is filtered on. */
const PERSON: Record<string, string> = { task: "assignee", project: "owner" };
const DATE: Record<string, string> = { task: "due", project: "target" };

/**
 * A tile's spec with the dashboard's filters added, only where the type has
 * the property (a program filter on a type without programs leaves it alone).
 */
export function applyDashboardFilters(spec: LensSpec, filters: DashboardFilters, catalog: LensCatalog): LensSpec {
  const has = (k: string | undefined) => Boolean(k && catalog[spec.type]?.properties.some((p) => p.key === k && !p.filterOnly));
  const extra: LensNode[] = [];
  if (filters.program && has("program")) extra.push({ property: "program", operator: "is", value: filters.program });
  if (filters.mine && has(PERSON[spec.type])) extra.push({ property: PERSON[spec.type], operator: "contains", value: { relative: "me" } });
  if (filters.dates && has(DATE[spec.type])) extra.push({ property: DATE[spec.type], operator: "is", value: { relative: filters.dates } });
  if (!extra.length) return spec;
  const own: LensNode[] = spec.where ? ("and" in spec.where ? spec.where.and : [spec.where]) : [];
  return { ...spec, where: { and: [...own, ...extra] } };
}
