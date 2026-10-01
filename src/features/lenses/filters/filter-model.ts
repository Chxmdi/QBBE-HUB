/**
 * The filter builder's behaviour as pure functions (U13): the editable tree
 * of AND/OR groups and conditions, its limits, what each condition needs as
 * a value, and the straight conversion to and from `lensSpecSchema.where`.
 * The component only wires these to the DOM, so the rules are unit-tested.
 */

import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import {
  EMPTINESS_OPERATORS,
  LIMITS,
  OPERATORS_BY_KIND,
  RELATIVE_DATES,
  type LensCondition,
  type LensGroup,
  type LensNode,
  type LensOperator,
  type RelativeDate,
} from "@/lib/query/spec";

export type Join = "and" | "or";

export interface FilterCondition {
  id: string;
  kind: "condition";
  property: string;
  operator: LensOperator;
  value?: unknown;
}

export interface FilterGroup {
  id: string;
  kind: "group";
  join: Join;
  items: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

/** What the value input must collect for a property and operator. */
export type ValueShape =
  | "none"
  | "text"
  | "number"
  | "number_range"
  | "date"
  | "date_range"
  | "choice"
  | "choices"
  | "person"
  | "boolean"
  | "id"
  | "ids"
  | "advanced";

export type Issue = "property" | "operator" | "value";

export const MAX_CONDITIONS = LIMITS.maxConditions;
export const MAX_DEPTH = LIMITS.maxDepth;

let counter = 0;
/** Stable keys for React rows; never stored. */
export function nextId(): string {
  counter += 1;
  return `f${counter}`;
}

export function emptyGroup(join: Join = "and"): FilterGroup {
  return { id: nextId(), kind: "group", join, items: [] };
}

// ---------------------------------------------------------------------------
// To and from the engine's where clause
// ---------------------------------------------------------------------------

function fromNode(node: LensNode): FilterNode {
  if ("property" in node) {
    return { id: nextId(), kind: "condition", property: node.property, operator: node.operator, value: node.value };
  }
  const join: Join = "and" in node ? "and" : "or";
  const items = "and" in node ? node.and : node.or;
  return { id: nextId(), kind: "group", join, items: items.map(fromNode) };
}

/** The editable tree for a saved where clause; an empty AND group when there is none. */
export function fromWhere(where: LensGroup | null | undefined): FilterGroup {
  if (!where) return emptyGroup("and");
  return fromNode(where) as FilterGroup;
}

function toNode(node: FilterNode, type: CatalogType): LensNode | null {
  if (node.kind === "condition") {
    if (!isComplete(node, type)) return null;
    const condition: LensCondition = { property: node.property, operator: node.operator };
    const shape = shapeOf(node, type);
    if (shape !== "none") condition.value = normaliseValue(node.value, shape);
    return condition;
  }
  const items = node.items.map((item) => toNode(item, type)).filter((item): item is LensNode => item !== null);
  if (items.length === 0) return null;
  return node.join === "and" ? { and: items } : { or: items };
}

/**
 * The where clause for the engine: only complete conditions, no empty
 * groups, nothing at all when there is nothing to ask. The result parses
 * with lensSpecSchema.
 */
export function toWhere(root: FilterGroup, type: CatalogType): LensGroup | undefined {
  const node = toNode(root, type);
  return node && !("property" in node) ? node : undefined;
}

// ---------------------------------------------------------------------------
// Properties, operators and value shapes
// ---------------------------------------------------------------------------

export function propertyOf(type: CatalogType, key: string): CatalogProperty | undefined {
  return type.properties.find((p) => p.key === key);
}

/** Operators the builder offers: every engine operator but the relation sub-query. */
export function operatorsFor(property: CatalogProperty): LensOperator[] {
  return OPERATORS_BY_KIND[property.kind].filter((o) => o !== "matches");
}

export function valueShape(property: CatalogProperty, operator: LensOperator): ValueShape {
  if (EMPTINESS_OPERATORS.includes(operator)) return "none";
  if (operator === "matches") return "advanced";
  switch (property.kind) {
    case "text":
      return "text";
    case "number":
      return operator === "between" ? "number_range" : "number";
    case "date":
      return operator === "between" ? "date_range" : "date";
    case "select":
      if (operator === "is_any_of" || operator === "is_none_of") return property.choices ? "choices" : "ids";
      return property.choices ? "choice" : "id";
    case "multi_select":
      return property.choices ? "choices" : "ids";
    case "person":
      return "person";
    case "checkbox":
      return "boolean";
    case "relation":
      return "id";
  }
}

function shapeOf(condition: FilterCondition, type: CatalogType): ValueShape {
  const property = propertyOf(type, condition.property);
  return property ? valueShape(property, condition.operator) : "advanced";
}

/** A starting value that makes the condition complete where one is obvious. */
export function defaultValue(shape: ValueShape, property?: CatalogProperty): unknown {
  switch (shape) {
    case "boolean":
      return true;
    case "date":
      return { relative: "today" };
    case "date_range":
      return { from: { relative: "today" }, to: { relative: "today" } };
    case "person":
      return { relative: "me" };
    case "choice":
      return property?.choices?.[0]?.key ?? "";
    default:
      return undefined;
  }
}

export function defaultCondition(property: CatalogProperty): FilterCondition {
  const operator = operatorsFor(property)[0];
  return { id: nextId(), kind: "condition", property: property.key, operator, value: defaultValue(valueShape(property, operator), property) };
}

/** The condition after its property changed: operator and value start over. */
export function withProperty(condition: FilterCondition, property: CatalogProperty): FilterCondition {
  return { ...defaultCondition(property), id: condition.id };
}

/** The condition after its operator changed: the value is kept when its shape is the same. */
export function withOperator(condition: FilterCondition, property: CatalogProperty, operator: LensOperator): FilterCondition {
  const before = valueShape(property, condition.operator);
  const after = valueShape(property, operator);
  return { ...condition, operator, value: before === after ? condition.value : defaultValue(after, property) };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const relativeDates = new Set<string>(RELATIVE_DATES);

export function isDateValue(value: unknown): value is { date: string } | { relative: RelativeDate } {
  if (typeof value !== "object" || value === null) return false;
  if ("date" in value) {
    const date = (value as { date: unknown }).date;
    if (typeof date !== "string" || !ISO_DATE.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  }
  return "relative" in value && typeof (value as { relative: unknown }).relative === "string" && relativeDates.has((value as { relative: string }).relative);
}

function isMe(value: unknown): value is { relative: "me" } {
  return typeof value === "object" && value !== null && (value as { relative?: unknown }).relative === "me";
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= LIMITS.maxString && !value.includes("\u0000");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether a value is usable for a shape, so the engine will accept it. */
export function hasValue(value: unknown, shape: ValueShape, property?: CatalogProperty): boolean {
  switch (shape) {
    case "none":
      return true;
    case "advanced":
      return value !== undefined;
    case "text":
    case "id":
      return nonEmptyText(value);
    case "number":
      return finite(value);
    case "number_range": {
      const v = value as { from?: unknown; to?: unknown } | null;
      return !!v && typeof v === "object" && finite(v.from) && finite(v.to);
    }
    case "date":
      return isDateValue(value);
    case "date_range": {
      const v = value as { from?: unknown; to?: unknown } | null;
      return !!v && typeof v === "object" && isDateValue(v.from) && isDateValue(v.to);
    }
    case "choice":
      return nonEmptyText(value) && (!property?.choices || property.choices.some((c) => c.key === value));
    case "choices":
    case "ids":
      return (
        Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= LIMITS.maxList &&
        value.every((v) => nonEmptyText(v) && (shape === "ids" || !property?.choices || property.choices.some((c) => c.key === v)))
      );
    case "person":
      return isMe(value) || nonEmptyText(value);
    case "boolean":
      return typeof value === "boolean";
  }
}

function normaliseValue(value: unknown, shape: ValueShape): unknown {
  if (shape === "text" || shape === "id" || shape === "choice") return (value as string).trim();
  if (shape === "ids" || shape === "choices") return (value as string[]).map((v) => v.trim());
  if (shape === "person") return isMe(value) ? { relative: "me" } : (value as string).trim();
  return value;
}

/** Why a condition cannot run yet, or null when it can. */
export function issueOf(condition: FilterCondition, type: CatalogType): Issue | null {
  const property = propertyOf(type, condition.property);
  if (!property) return "property";
  if (!(OPERATORS_BY_KIND[property.kind] as readonly string[]).includes(condition.operator)) return "operator";
  if (!hasValue(condition.value, valueShape(property, condition.operator), property)) return "value";
  return null;
}

export function isComplete(condition: FilterCondition, type: CatalogType): boolean {
  return issueOf(condition, type) === null;
}

// ---------------------------------------------------------------------------
// Tree edits (immutable)
// ---------------------------------------------------------------------------

function mapTree(node: FilterNode, fn: (node: FilterNode) => FilterNode | null): FilterNode | null {
  const next = fn(node);
  if (!next || next.kind === "condition") return next;
  return {
    ...next,
    items: next.items.map((item) => mapTree(item, fn)).filter((item): item is FilterNode => item !== null),
  };
}

export function updateNode(root: FilterGroup, id: string, change: (node: FilterNode) => FilterNode): FilterGroup {
  return mapTree(root, (node) => (node.id === id ? change(node) : node)) as FilterGroup;
}

/** Removes a node; the root group itself stays. */
export function removeNode(root: FilterGroup, id: string): FilterGroup {
  if (id === root.id) return root;
  return mapTree(root, (node) => (node.id === id ? null : node)) as FilterGroup;
}

export function appendTo(root: FilterGroup, groupId: string, node: FilterNode): FilterGroup {
  return updateNode(root, groupId, (group) => (group.kind === "group" ? { ...group, items: [...group.items, node] } : group));
}

export function setJoin(root: FilterGroup, groupId: string, join: Join): FilterGroup {
  return updateNode(root, groupId, (group) => (group.kind === "group" ? { ...group, join } : group));
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export function countConditions(node: FilterNode): number {
  if (node.kind === "condition") return 1;
  return node.items.reduce((sum, item) => sum + countConditions(item), 0);
}

/** The depth of a group, the root being 1; null when it is not in the tree. */
export function depthOfGroup(root: FilterGroup, groupId: string, depth = 1): number | null {
  if (root.id === groupId) return depth;
  for (const item of root.items) {
    if (item.kind !== "group") continue;
    const found = depthOfGroup(item, groupId, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/**
 * How deep groups may go. The table wraps an OR root in an AND with the
 * title search, which counts as one more level in the engine, so an OR root
 * gets one level less.
 */
export function maxDepthFor(root: FilterGroup): number {
  return root.join === "or" ? MAX_DEPTH - 1 : MAX_DEPTH;
}

export function canAddCondition(root: FilterGroup): boolean {
  return countConditions(root) < MAX_CONDITIONS;
}

export function canAddGroup(root: FilterGroup, groupId: string): boolean {
  const depth = depthOfGroup(root, groupId);
  return depth !== null && depth < maxDepthFor(root);
}

// ---------------------------------------------------------------------------
// Readable summaries
// ---------------------------------------------------------------------------

export interface SummaryLabels {
  operator: (operator: LensOperator) => string;
  relative: (key: string) => string;
  me: string;
  yes: string;
  no: string;
  and: string;
  or: string;
  advanced: string;
}

function dateText(value: unknown, labels: SummaryLabels): string {
  if (!isDateValue(value)) return "";
  return "date" in value ? value.date : labels.relative(value.relative);
}

export function describeValue(
  property: CatalogProperty,
  operator: LensOperator,
  value: unknown,
  locale: string,
  labels: SummaryLabels,
  people: { id: string; label: string }[] = [],
): string {
  const shape = valueShape(property, operator);
  const choice = (key: string) => {
    const c = property.choices?.find((x) => x.key === key);
    return c ? (locale.startsWith("fr") ? c.label.fr : c.label.en) : key;
  };
  switch (shape) {
    case "none":
      return "";
    case "advanced":
      return labels.advanced;
    case "text":
    case "id":
      return `“${String(value ?? "")}”`;
    case "number":
      return String(value ?? "");
    case "number_range": {
      const v = (value ?? {}) as { from?: number; to?: number };
      return `${v.from ?? ""} – ${v.to ?? ""}`;
    }
    case "date":
      return dateText(value, labels);
    case "date_range": {
      const v = (value ?? {}) as { from?: unknown; to?: unknown };
      return `${dateText(v.from, labels)} – ${dateText(v.to, labels)}`;
    }
    case "choice":
      return choice(String(value ?? ""));
    case "choices":
    case "ids":
      return (Array.isArray(value) ? value : []).map((v) => choice(String(v))).join(", ");
    case "person":
      if (isMe(value)) return labels.me;
      return people.find((p) => p.id === value)?.label ?? String(value ?? "");
    case "boolean":
      return value ? labels.yes : labels.no;
  }
}

/** "Priority is High", or "(Priority is High or Status is Ready)" for a group. */
export function describeNode(
  node: LensNode,
  type: CatalogType,
  locale: string,
  labels: SummaryLabels,
  people: { id: string; label: string }[] = [],
): string {
  if ("property" in node) {
    const property = propertyOf(type, node.property);
    const name = property ? (locale.startsWith("fr") ? property.name.fr : property.name.en) : node.property;
    const value = property ? describeValue(property, node.operator, node.value, locale, labels, people) : "";
    return [name, labels.operator(node.operator), value].filter(Boolean).join(" ");
  }
  const join = "and" in node ? labels.and : labels.or;
  const items = "and" in node ? node.and : node.or;
  return `(${items.map((item) => describeNode(item, type, locale, labels, people)).join(` ${join} `)})`;
}

/** One line per top-level item of a where clause, for chips. */
export function summarise(
  where: LensGroup | null | undefined,
  type: CatalogType,
  locale: string,
  labels: SummaryLabels,
  people: { id: string; label: string }[] = [],
): string[] {
  if (!where) return [];
  const items = "and" in where ? where.and : where.or;
  return items.map((item) => describeNode(item, type, locale, labels, people));
}
