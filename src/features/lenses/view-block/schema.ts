import { z } from "zod";
import {
  lensSpecSchema,
  LIMITS,
  OPERATORS_BY_KIND,
  type LensNode,
  type LensOperator,
  type LensSpec,
} from "@/lib/query/spec";
import { QUERY_BLOCK_MAX_ROWS } from "@/features/lenses/query-block/schema";
import { DEFAULT_FACTS } from "@/features/lenses/cards/cards";
import { D3_LAYOUTS, d3PropsShape } from "./layouts/d3.ids";
import { D4_LAYOUTS, d4PropsShape } from "./layouts/d4.ids";

/**
 * The view block (U6): a generic, read-only lens inside a page. Version 2 of
 * the editor's `query` block props: version 1 is the preset list M5 shipped
 * (src/features/editor/semantic/queries.ts) and keeps rendering as it did.
 *
 * A block shows a type or a saved lens the reader can see, in one of five
 * layouts, narrowed by a flat list of AND conditions (the nested builder is
 * another unit's). Everything runs through `lens_query` as the reader, so two
 * people reading the same page see their own rows.
 */

export const VIEW_BLOCK_VERSION = 2;
/** The block's own layouts; wave 2 units D3 and D4 add theirs in layouts/. */
export const BASE_VIEW_LAYOUTS = ["table", "board", "list", "calendar", "gallery"] as const;
export const VIEW_LAYOUTS = [...BASE_VIEW_LAYOUTS, ...D3_LAYOUTS, ...D4_LAYOUTS] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];
export type BaseViewLayout = (typeof BASE_VIEW_LAYOUTS)[number];

export const VIEW_BLOCK_LIMITS = {
  maxConditions: 20,
  maxSorts: LIMITS.maxSorts,
  maxFields: 8,
  maxPageFilters: 8,
  maxRows: QUERY_BLOCK_MAX_ROWS,
  defaultRows: 50,
} as const;

const propertyRef = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Unknown property");

/** Every engine operator except `matches`, which needs a nested group. */
export const FLAT_OPERATORS = [...new Set(Object.values(OPERATORS_BY_KIND).flat())].filter(
  (op) => op !== "matches",
) as [LensOperator, ...LensOperator[]];

export const viewConditionSchema = z
  .object({
    path: propertyRef,
    op: z.enum(FLAT_OPERATORS),
    value: z.unknown().optional(),
  })
  .strict();
export type ViewCondition = z.infer<typeof viewConditionSchema>;

export const viewSourceSchema = z.union([
  z.object({ type: propertyRef }).strict(),
  z.object({ lensId: z.string().uuid() }).strict(),
]);
export type ViewSource = z.infer<typeof viewSourceSchema>;

const baseSchema = z
  .object({
    version: z.literal(VIEW_BLOCK_VERSION),
    source: viewSourceSchema,
    layout: z.enum(VIEW_LAYOUTS).default("table"),
    title: z.string().trim().max(120).optional(),
    where: z.array(viewConditionSchema).max(VIEW_BLOCK_LIMITS.maxConditions).default([]),
    sort: z
      .array(z.object({ path: propertyRef, direction: z.enum(["asc", "desc"]).default("asc") }).strict())
      .max(VIEW_BLOCK_LIMITS.maxSorts)
      .default([]),
    groupBy: z.object({ path: propertyRef }).strict().optional(),
    fields: z.array(propertyRef).max(VIEW_BLOCK_LIMITS.maxFields).default([]),
    pageFilters: z
      .object({
        enabled: z.boolean().default(false),
        paths: z.array(propertyRef).max(VIEW_BLOCK_LIMITS.maxPageFilters).default([]),
      })
      .strict()
      .default({ enabled: false, paths: [] }),
    maxRows: z.number().int().min(1).max(VIEW_BLOCK_LIMITS.maxRows).default(VIEW_BLOCK_LIMITS.defaultRows),
    // Wave 2 units' own optional props (layouts/d3.ids.ts, layouts/d4.ids.ts).
    ...d3PropsShape,
    ...d4PropsShape,
  })
  .strict();

/**
 * Values are checked by the engine's own schema: the block's conditions are
 * turned into a lens spec and that spec must parse, so nothing the engine
 * would refuse is stored in a page.
 */
export const viewBlockPropsSchema = baseSchema.superRefine((props, ctx) => {
  const probe = composeSpec({ type: "type" in props.source ? props.source.type : "task", props, extra: [] });
  if (!lensSpecSchema.safeParse(probe).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The engine refuses these settings.", path: ["where"] });
  }
});

export type ViewBlockProps = z.input<typeof baseSchema>;
export type ParsedViewBlockProps = z.output<typeof baseSchema>;

/** Parses block props; a block with bad props renders its error state, never crashes the page. */
export function parseViewBlockProps(input: unknown): ParsedViewBlockProps | null {
  const parsed = viewBlockPropsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/**
 * What the editor's `query` block stores in `props.spec`: version 2 JSON is a
 * view block (valid or not: a damaged one shows its error state rather than
 * falling back to the preset list), anything else is the legacy preset spec.
 */
export function readStoredViewBlock(raw: unknown): { kind: "view"; raw: unknown } | { kind: "legacy" } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { kind: "legacy" };
    }
  }
  if (value && typeof value === "object" && (value as { version?: unknown }).version === VIEW_BLOCK_VERSION) {
    return { kind: "view", raw: value };
  }
  return { kind: "legacy" };
}

export function conditionToNode(condition: ViewCondition): LensNode {
  return {
    property: condition.path,
    operator: condition.op,
    ...(condition.value === undefined ? {} : { value: condition.value }),
  };
}

/** The property a board groups by when the block and the lens choose none. */
export const DEFAULT_GROUP: Record<string, string> = { task: "status", project: "stage" };
/** The date a calendar lays rows out on when the block chooses none. */
export const DEFAULT_DATE: Record<string, string> = { task: "due", project: "target" };

/** The date property a calendar layout uses: the first date field, then the type's default. */
export function calendarPath(props: Pick<ParsedViewBlockProps, "fields" | "sort">, type: string, dateKeys: readonly string[]): string | null {
  const chosen = [...props.fields, ...props.sort.map((s) => s.path)].find((k) => dateKeys.includes(k));
  if (chosen) return chosen;
  const fallback = DEFAULT_DATE[type];
  return fallback && dateKeys.includes(fallback) ? fallback : (dateKeys[0] ?? null);
}

export interface ComposeInput {
  /** The type the block shows (the saved lens's, when it has one). */
  type: string;
  /** The saved lens's spec, when the block points at one. */
  base?: LensSpec | null;
  props: ParsedViewBlockProps;
  /** Conditions added at run time: page-local filters, a calendar window. */
  extra: ViewCondition[];
}

/**
 * The spec the engine runs: the saved lens's conditions AND the block's AND
 * the run-time ones. The block's sort, grouping and fields win over the
 * lens's when set; a board always has a group property. Pure, so the saved
 * lens is never changed by anything a reader does.
 */
export function composeSpec({ type, base, props, extra }: ComposeInput): LensSpec {
  const nodes: LensNode[] = [];
  if (base?.where) nodes.push(base.where);
  for (const condition of props.where) nodes.push(conditionToNode(condition));
  for (const condition of extra) nodes.push(conditionToNode(condition));

  const sort = props.sort.length ? props.sort.map((s) => ({ property: s.path, direction: s.direction })) : base?.sort;
  const groupKey =
    props.groupBy?.path ?? base?.groupBy?.property ?? (props.layout === "board" ? DEFAULT_GROUP[type] : undefined);
  const fields = props.fields.length ? props.fields : (base?.select?.length ? base.select : (DEFAULT_FACTS[type] ?? []));
  const select = [...new Set([...fields, ...(groupKey ? [groupKey] : [])])].slice(0, LIMITS.maxSelect);

  return {
    version: 1,
    type,
    ...(nodes.length ? { where: { and: nodes } } : {}),
    ...(sort?.length ? { sort } : {}),
    ...(groupKey ? { groupBy: { property: groupKey } } : {}),
    ...(select.length ? { select } : {}),
    limit: Math.min(props.maxRows, VIEW_BLOCK_LIMITS.maxRows),
    offset: 0,
  };
}
