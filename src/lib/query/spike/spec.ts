// W0-8 spike: the lens "query spec", the JSON a lens stores and the compiler
// turns into SQL. Parsing is strict: unknown keys, wrong shapes, oversize
// values and anything past the limits below are rejected before the compiler
// sees them. The compiler then checks every property name, operator, value
// type and sort/group key against the catalog (catalog.ts).

import { z } from "zod";

export const PROPERTY_KINDS = [
  "text",
  "number",
  "date",
  "select",
  "multi_select",
  "person",
  "checkbox",
  "relation",
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

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

/** Operators each kind accepts. Anything else is rejected for that kind. */
export const OPERATORS_BY_KIND = {
  text: ["equals", "not_equals", "contains", "not_contains", "starts_with", "is_empty", "is_not_empty"],
  number: ["eq", "neq", "lt", "lte", "gt", "gte", "between", "is_empty", "is_not_empty"],
  date: ["is", "before", "after", "on_or_before", "on_or_after", "between", "is_empty", "is_not_empty"],
  select: ["is", "is_not", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
  multi_select: ["has_any", "has_all", "has_none", "is_empty", "is_not_empty"],
  person: ["contains", "not_contains", "is_empty", "is_not_empty"],
  checkbox: ["is"],
  relation: ["contains", "not_contains", "is_empty", "is_not_empty", "matches"],
} as const satisfies Record<PropertyKind, readonly string[]>;

export type Operator = (typeof OPERATORS_BY_KIND)[PropertyKind][number];
const ALL_OPERATORS = [...new Set(Object.values(OPERATORS_BY_KIND).flat())] as [Operator, ...Operator[]];

export const LIMITS = {
  maxConditions: 50,
  maxDepth: 4,
  maxSorts: 3,
  maxSelect: 30,
  maxPageSize: 200,
  maxOffset: 10_000,
  maxString: 500,
  maxList: 100,
} as const;

// Property references are short slugs. The compiler still looks every one up
// in the catalog; the pattern only keeps garbage out of error messages.
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
// Postgres text cannot hold a NUL byte; reject it here instead of failing in the database.
const text = z
  .string()
  .max(LIMITS.maxString)
  .refine((s) => !s.includes("\u0000"), "Invalid character");
const finiteNumber = z.number().finite();

/** Every value shape a condition can carry; the compiler checks it fits the kind and operator. */
const scalarValue = z.union([
  text,
  finiteNumber,
  z.boolean(),
  dateValueSchema,
  meValue,
  z.object({ from: finiteNumber, to: finiteNumber }).strict(),
  z.object({ from: dateValueSchema, to: dateValueSchema }).strict(),
  z.array(z.union([text, meValue])).max(LIMITS.maxList),
]);

export interface Condition {
  property: string;
  operator: Operator;
  value?: unknown;
}
export interface Group {
  and?: Array<Condition | Group>;
  or?: Array<Condition | Group>;
}
/** "matches": filter a relation by conditions on the related objects (one level only). */
export interface RelationMatch {
  property: string;
  operator: "matches";
  value: { where: Group };
}

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
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
) as z.ZodType<Condition>;

const groupSchema: z.ZodType<Group> = z.lazy(() =>
  z.union([
    z.object({ and: z.array(z.union([conditionSchema, groupSchema])).min(1).max(LIMITS.maxConditions) }).strict(),
    z.object({ or: z.array(z.union([conditionSchema, groupSchema])).min(1).max(LIMITS.maxConditions) }).strict(),
  ]),
);

export const querySpecSchema = z
  .object({
    version: z.literal(1),
    type: propertyRef,
    where: groupSchema.optional(),
    sort: z
      .array(
        z
          .object({ property: propertyRef, direction: z.enum(["asc", "desc"]).default("asc") })
          .strict(),
      )
      .max(LIMITS.maxSorts)
      .default([]),
    groupBy: z.object({ property: propertyRef }).strict().optional(),
    select: z.array(propertyRef).max(LIMITS.maxSelect).default([]),
    limit: z.number().int().min(1).max(LIMITS.maxPageSize).default(100),
    offset: z.number().int().min(0).max(LIMITS.maxOffset).default(0),
  })
  .strict();

export type QuerySpec = z.infer<typeof querySpecSchema>;
export type QuerySpecInput = z.input<typeof querySpecSchema>;
