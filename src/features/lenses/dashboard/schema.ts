import { z } from "zod";
import { lensSpecSchema, RELATIVE_DATES } from "@/lib/query/spec";

/**
 * A dashboard lens (V1-5): tiles in a grid plus dashboard-wide filters, kept
 * in lens.layout (kind 'dashboard'). Every tile reads through the engine as
 * whoever is looking, so a shared dashboard shows each person their own rows.
 */

export const TILE_KINDS = [
  "metric",
  "chart",
  "query",
  "table",
  "board",
  "calendar",
  "progress",
  "text",
  "activity",
  "goal",
  "embed",
] as const;
export type TileKind = (typeof TILE_KINDS)[number];

const key = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const uuid = z.string().uuid();

/** Where a tile's rows come from: a saved lens, or a type with optional conditions. */
export const tileSourceSchema = z.union([
  z.object({ lensId: uuid }).strict(),
  z.object({ spec: lensSpecSchema }).strict(),
]);
export type TileSource = z.infer<typeof tileSourceSchema>;

const measureSchema = z.union([
  z.object({ kind: z.literal("count") }).strict(),
  z.object({ kind: z.literal("sum"), property: key }).strict(),
]);

const base = {
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: z.string().trim().max(120).default(""),
  width: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
};

export const tileSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("metric"), source: tileSourceSchema, measure: measureSchema.default({ kind: "count" }) }).strict(),
  z.object({ ...base, kind: z.literal("chart"), source: tileSourceSchema, groupBy: key }).strict(),
  z.object({ ...base, kind: z.literal("query"), source: tileSourceSchema, rows: z.number().int().min(1).max(50).default(10) }).strict(),
  z.object({ ...base, kind: z.literal("table"), source: tileSourceSchema, rows: z.number().int().min(1).max(50).default(10) }).strict(),
  z.object({ ...base, kind: z.literal("board"), source: tileSourceSchema }).strict(),
  z.object({ ...base, kind: z.literal("calendar"), source: tileSourceSchema, dateProperty: key.default("due"), days: z.number().int().min(1).max(60).default(14) }).strict(),
  z.object({ ...base, kind: z.literal("progress"), source: tileSourceSchema, doneProperty: key.default("status"), doneValue: z.string().max(64).default("completed") }).strict(),
  z.object({ ...base, kind: z.literal("text"), body: z.string().max(2000).default("") }).strict(),
  z.object({ ...base, kind: z.literal("activity"), source: tileSourceSchema, rows: z.number().int().min(1).max(20).default(8) }).strict(),
  z.object({ ...base, kind: z.literal("goal"), source: tileSourceSchema, measure: measureSchema.default({ kind: "count" }), target: z.number().finite().positive() }).strict(),
  z.object({ ...base, kind: z.literal("embed"), lensId: uuid, view: z.enum(["table", "list", "board"]).default("table") }).strict(),
]);
export type Tile = z.infer<typeof tileSchema>;

/** Filters that apply to every tile where the property exists. */
export const dashboardFiltersSchema = z
  .object({
    program: uuid.optional(),
    mine: z.boolean().optional(),
    dates: z.enum(RELATIVE_DATES).optional(),
  })
  .strict();
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const dashboardLayoutSchema = z
  .object({
    tiles: z.array(tileSchema).max(24).default([]),
    filters: dashboardFiltersSchema.default({}),
  })
  .strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

export function parseDashboardLayout(input: unknown): DashboardLayout {
  const parsed = dashboardLayoutSchema.safeParse(input ?? {});
  return parsed.success ? parsed.data : { tiles: [], filters: {} };
}

/** Filters from the page URL (they override the saved ones, so a link can narrow a dashboard). */
export function filtersFromParams(params: Record<string, string | string[] | undefined>, saved: DashboardFilters): DashboardFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next: DashboardFilters = { ...saved };
  const program = one(params.program);
  if (program !== undefined) next.program = uuid.safeParse(program).success ? program : undefined;
  const mine = one(params.mine);
  if (mine !== undefined) next.mine = mine === "1";
  const dates = one(params.dates);
  if (dates !== undefined) next.dates = (RELATIVE_DATES as readonly string[]).includes(dates) ? (dates as DashboardFilters["dates"]) : undefined;
  return dashboardFiltersSchema.parse(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== false)));
}
