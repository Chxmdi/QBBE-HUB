import { z } from "zod";

/**
 * A type's page layout (V2-4): an ordered list of sections. Presentation
 * only; every value a section shows is still read under the viewer's RLS.
 *
 * Contract addition: `ObjectLayout` is what object pages render from. The
 * section kinds `content`, `comments` and `versions` are slots the block
 * editor, M11 comments and M16 versions fill when integration mounts them.
 */

const sectionId = z.string().regex(/^[a-z0-9_-]{1,40}$/);
const title = z
  .object({ en: z.string().trim().max(80), fr: z.string().trim().max(80) })
  .optional();

export const sectionSchema = z.discriminatedUnion("kind", [
  z.object({
    id: sectionId,
    kind: z.literal("properties"),
    title,
    properties: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(60),
  }),
  z.object({
    id: sectionId,
    kind: z.literal("related"),
    title,
    relation: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    limit: z.number().int().min(1).max(50),
  }),
  z.object({ id: sectionId, kind: z.literal("content"), title }),
  z.object({ id: sectionId, kind: z.literal("comments"), title }),
  z.object({ id: sectionId, kind: z.literal("versions"), title }),
]);

export const layoutSchema = z
  .object({ version: z.literal(1), sections: z.array(sectionSchema).max(30) })
  .refine((layout) => new Set(layout.sections.map((s) => s.id)).size === layout.sections.length, {
    message: "duplicate_section",
  });

export type LayoutSection = z.infer<typeof sectionSchema>;
export type ObjectLayout = z.infer<typeof layoutSchema>;
export type SectionKind = LayoutSection["kind"];

/** What a type can show: its properties and its related lists, in catalogue order. */
export interface LayoutCatalog {
  properties: string[];
  relations: string[];
}

/** Every property in one section, then content, related lists and comments. */
export function defaultLayout(catalog: LayoutCatalog): ObjectLayout {
  return {
    version: 1,
    sections: [
      { id: "properties", kind: "properties", properties: [...catalog.properties] },
      { id: "content", kind: "content" },
      ...catalog.relations.map((relation) => ({
        id: `related-${relation}`.slice(0, 40).replace(/_/g, "-"),
        kind: "related" as const,
        relation,
        limit: 10,
      })),
      { id: "comments", kind: "comments" },
    ],
  };
}

/**
 * A stored layout against today's catalogue: unknown properties and
 * relations (removed since) are dropped, duplicates kept once, and a
 * property shown in two sections stays in the first only.
 */
export function normalizeLayout(layout: ObjectLayout, catalog: LayoutCatalog): ObjectLayout {
  const seen = new Set<string>();
  const sections = layout.sections.flatMap((section): LayoutSection[] => {
    if (section.kind === "properties") {
      const properties = section.properties.filter((key) => {
        if (!catalog.properties.includes(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [{ ...section, properties }];
    }
    if (section.kind === "related") return catalog.relations.includes(section.relation) ? [section] : [];
    return [section];
  });
  return { version: 1, sections };
}

/** Parses stored JSON; anything unreadable falls back to the default. */
export function readLayout(raw: unknown, catalog: LayoutCatalog): ObjectLayout {
  const parsed = layoutSchema.safeParse(raw);
  return parsed.success ? normalizeLayout(parsed.data, catalog) : defaultLayout(catalog);
}

/** Properties the layout does not show anywhere. */
export function hiddenProperties(layout: ObjectLayout, catalog: LayoutCatalog): string[] {
  const shown = new Set(
    layout.sections.flatMap((section) => (section.kind === "properties" ? section.properties : [])),
  );
  return catalog.properties.filter((key) => !shown.has(key));
}

/** Moves an item one place up (-1) or down (+1); out of range is a no-op. */
export function move<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** A section id not used yet, from a base like `properties` or `related-project`. */
export function freshSectionId(layout: ObjectLayout, base: string): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 34) || "section";
  const used = new Set(layout.sections.map((section) => section.id));
  if (!used.has(clean)) return clean;
  for (let n = 2; n < 1000; n++) if (!used.has(`${clean}-${n}`)) return `${clean}-${n}`;
  return `${clean}-${Date.now() % 100000}`;
}
