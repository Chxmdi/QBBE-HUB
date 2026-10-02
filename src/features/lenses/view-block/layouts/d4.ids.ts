import { z } from "zod";

/**
 * Wave 2 unit D4 (timeline, gallery and feed layouts): the layout ids it adds to the view block and the
 * extra block props they need. Only D4 edits this file (and d4-layouts.tsx).
 * Kept free of React so the block's schema can import it.
 *
 * The gallery is one of the block's own layouts; D4 draws it (with its cover
 * property) through the same slot, so it adds only timeline and feed here.
 */

/** Layout ids this unit adds, e.g. ["chart"]. Must not repeat a base layout. */
export const D4_LAYOUTS = ["timeline", "feed"] as const;

// Same rule as the block's own property references (schema.ts), kept here so
// this file does not import the schema that imports it.
const propertyRef = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Unknown property");

/** Extra, optional block props (zod shape) merged into the view block schema. */
export const d4PropsShape = {
  /** Timeline: the date properties a bar starts and ends on (defaults per type when unset). */
  timeline: z.object({ start: propertyRef.optional(), end: propertyRef.optional() }).strict().optional(),
  /** Gallery: the property drawn as each card's cover. */
  gallery: z.object({ cover: propertyRef.optional() }).strict().optional(),
  /** Feed: the date or time each entry is placed by (defaults to the last edit). */
  feed: z.object({ date: propertyRef.optional() }).strict().optional(),
} satisfies z.ZodRawShape;

/** The part of a block's props this unit reads. */
export interface D4Props {
  layout: string;
  timeline?: { start?: string; end?: string };
  gallery?: { cover?: string };
  feed?: { date?: string };
}

/** What D4 needs to know about a property to choose it. */
export interface D4Property {
  key: string;
  kind: string;
  propertyKind?: string;
  timestamp?: boolean;
  filterOnly?: boolean;
}

/** The start and end a timeline uses when the block chooses none. */
const DEFAULT_TIMELINE: Record<string, { start: string; end: string }> = {
  task: { start: "start", end: "due" },
  project: { start: "start", end: "target" },
  meeting: { start: "starts", end: "ends" },
};

const isDate = (p: D4Property) => p.kind === "date" && !p.filterOnly;

/** Date properties a timeline or feed can use. */
export function dateProperties<P extends D4Property>(properties: readonly P[]): P[] {
  return properties.filter(isDate);
}

/** Properties a gallery card can show as its cover: a choice, a person, a relation or text. */
export function coverProperties<P extends D4Property>(properties: readonly P[]): P[] {
  return properties.filter(
    (p) => !p.filterOnly && p.key !== "title" && (p.kind === "select" || p.kind === "person" || p.kind === "relation" || p.kind === "text"),
  );
}

/**
 * The timeline's start and end properties: the block's choice when it is a
 * date property of the type, else the type's default, else the first two
 * date properties. Either can be null (a type with no dates).
 */
export function timelinePaths(props: Pick<D4Props, "timeline">, type: string, properties: readonly D4Property[]): { start: string | null; end: string | null } {
  const dates = dateProperties(properties).map((p) => p.key);
  const has = (k: string | undefined): k is string => Boolean(k && dates.includes(k));
  const fallback = DEFAULT_TIMELINE[type];
  const plain = dateProperties(properties).filter((p) => !p.timestamp).map((p) => p.key);
  const start = has(props.timeline?.start) ? props.timeline.start : has(fallback?.start) ? fallback.start : (plain[0] ?? dates[0] ?? null);
  const endChoice = has(props.timeline?.end) ? props.timeline.end : has(fallback?.end) ? fallback.end : (plain.find((k) => k !== start) ?? null);
  return { start, end: endChoice && endChoice !== start ? endChoice : null };
}

/** The feed's date: the block's choice, else the last edit, else the creation time, else the first date. */
export function feedPath(props: Pick<D4Props, "feed">, properties: readonly D4Property[]): string | null {
  const dates = dateProperties(properties).map((p) => p.key);
  const chosen = props.feed?.date;
  if (chosen && dates.includes(chosen)) return chosen;
  return ["edited_time", "created_time"].find((k) => dates.includes(k)) ?? dates[0] ?? null;
}

/** The gallery's cover property, when the block chose a usable one. */
export function coverPath(props: Pick<D4Props, "gallery">, properties: readonly D4Property[]): string | null {
  const chosen = props.gallery?.cover;
  return chosen && coverProperties(properties).some((p) => p.key === chosen) ? chosen : null;
}

/**
 * The properties a D4 layout reads besides the block's fields (a timeline's
 * dates, a feed's date, a gallery's cover), so the run selects them. Only
 * properties of the type are returned; other layouts need none.
 */
export function d4Columns(props: D4Props, type: string, properties: readonly D4Property[]): string[] {
  if (props.layout === "timeline") {
    const { start, end } = timelinePaths(props, type, properties);
    return [start, end].filter((k): k is string => Boolean(k));
  }
  if (props.layout === "feed") {
    const date = feedPath(props, properties);
    return date ? [date] : [];
  }
  if (props.layout === "gallery") {
    const cover = coverPath(props, properties);
    return cover ? [cover] : [];
  }
  return [];
}

/** A spec's select with the D4 columns added (once, within the engine's limit). */
export function withD4Columns<S extends { select?: string[] }>(spec: S, props: D4Props, type: string, properties: readonly D4Property[], maxSelect = 30): S {
  const extra = d4Columns(props, type, properties).filter((k) => !(spec.select ?? []).includes(k));
  if (!extra.length) return spec;
  // The layout cannot draw without its columns, so they win over the last shown ones.
  return { ...spec, select: [...(spec.select ?? []).slice(0, Math.max(0, maxSelect - extra.length)), ...extra] };
}
