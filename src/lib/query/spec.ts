/**
 * The lens query spec (M8a, epic #199): the JSON a lens stores and the engine
 * runs. Format, operators and limits follow the W0-8 spike
 * (docs/design/spikes/W0-8-query-engine.md).
 *
 * Parsing here is strict (exact shapes, no unknown keys, sizes capped), so a
 * bad spec is refused before a round trip. The database repeats every check
 * (`public.lens_compile`), because it is the part a caller cannot skip.
 */

import { z } from "zod";

export const LENS_KINDS = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "person",
  "checkbox",
  "relation",
] as const;
export type LensPropertyKind = (typeof LENS_KINDS)[number];

export const RELATIVE_DATES = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_7_days",
  "next_7_days",
] as const;
export type RelativeDate = (typeof RELATIVE_DATES)[number];

/** Operators each kind accepts; the database has the same table. */
export const OPERATORS_BY_KIND = {
  text: ["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "lt", "lte", "gt", "gte", "between", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "on_or_before", "on_or_after", "between", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_select: ["has_any", "has_all", "has_none", "is_empty", "is_not_empty"],
  person: ["contains", "not_contains", "is_empty", "is_not_empty"],
  checkbox: ["is"],
  relation: ["contains", "not_contains", "is_empty", "is_not_empty", "matches"],
} as const satisfies Record<LensPropertyKind, readonly string[]>;

export type LensOperator = (typeof OPERATORS_BY_KIND)[LensPropertyKind][number];
const ALL_OPERATORS = [...new Set(Object.values(OPERATORS_BY_KIND).flat())] as [
  LensOperator,
  ...LensOperator[],
];

/** Operators that take no value. */
export const EMPTINESS_OPERATORS: readonly LensOperator[] = ["is_empty", "is_not_empty"];

export const LIMITS = {
  maxConditions: 50,
  maxDepth: 4,
  maxSorts: 3,
  maxSelect: 30,
  maxPageSize: 1000,
  maxOffset: 10_000,
  maxString: 500,
  maxList: 100,
} as const;

const propertyRef = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Unknown property");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid date");

export const dateValueSchema = z.union([
  z.object({ date: isoDate }).strict(),
  z.object({ relative: z.enum(RELATIVE_DATES) }).strict(),
]);
export type DateValue = z.infer<typeof dateValueSchema>;

const meValue = z.object({ relative: z.literal("me") }).strict();
// Postgres text cannot hold a NUL byte; refuse it here rather than in the database.
const text = z
  .string()
  .max(LIMITS.maxString)
  .refine((s) => !s.includes("\u0000"), "Invalid character");
const finiteNumber = z.number().finite();

const scalarValue = z.union([
  text,
  finiteNumber,
  z.boolean(),
  dateValueSchema,
  meValue,
  z.object({ from: finiteNumber, to: finiteNumber }).strict(),
  z.object({ from: dateValueSchema, to: dateValueSchema }).strict(),
  z.array(z.union([text, meValue])).min(1).max(LIMITS.maxList),
]);

export interface LensCondition {
  property: string;
  operator: LensOperator;
  value?: unknown;
}
export type LensGroup = { and: LensNode[] } | { or: LensNode[] };
export type LensNode = LensCondition | LensGroup;

const conditionSchema: z.ZodType<LensCondition> = z.lazy(() =>
  z.union([
    z
      .object({
        property: propertyRef,
        operator: z.literal("matches"),
        value: z.object({ where: groupSchema }).strict(),
      })
      .strict(),
    z
      .object({
        property: propertyRef,
        operator: z.enum(ALL_OPERATORS),
        value: scalarValue.optional(),
      })
      .strict(),
  ]),
) as z.ZodType<LensCondition>;

const nodeSchema: z.ZodType<LensNode> = z.lazy(() => z.union([conditionSchema, groupSchema]));

const groupSchema: z.ZodType<LensGroup> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(nodeSchema).min(1).max(LIMITS.maxConditions) }).strict(),
    z.object({ or: z.array(nodeSchema).min(1).max(LIMITS.maxConditions) }).strict(),
  ]),
);

export const lensSpecSchema = z
  .object({
    version: z.literal(1),
    type: propertyRef,
    where: groupSchema.optional(),
    sort: z
      .array(
        z
          .object({ property: propertyRef, direction: z.enum(["asc", "desc"]).optional() })
          .strict(),
      )
      .max(LIMITS.maxSorts)
      .optional(),
    groupBy: z.object({ property: propertyRef }).strict().optional(),
    select: z.array(propertyRef).max(LIMITS.maxSelect).optional(),
    limit: z.number().int().min(1).max(LIMITS.maxPageSize).optional(),
    offset: z.number().int().min(0).max(LIMITS.maxOffset).optional(),
  })
  .strict();

export type LensSpec = z.infer<typeof lensSpecSchema>;

/** Counts conditions and nesting the way the database does. */
export function measure(node: LensNode, depth = 1): { conditions: number; depth: number } {
  if ("property" in node) {
    const inner =
      node.operator === "matches"
        ? measure((node.value as { where: LensGroup }).where, depth + 1)
        : { conditions: 0, depth };
    return { conditions: 1 + inner.conditions, depth: Math.max(depth, inner.depth) };
  }
  const items = "and" in node ? node.and : node.or;
  return items.reduce(
    (acc, item) => {
      const m = measure(item, "property" in item ? depth : depth + 1);
      return { conditions: acc.conditions + m.conditions, depth: Math.max(acc.depth, m.depth) };
    },
    { conditions: 0, depth },
  );
}
