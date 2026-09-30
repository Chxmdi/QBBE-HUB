import type { LocalizedText } from "@/lib/objects/contracts";
import { keyFromName, type Blueprint, type BlueprintProperty, type BlueprintRelation, type BlueprintType } from "./schema";

/**
 * The designer's edits as pure functions over a blueprint. The canvas and the
 * list editor both call these, so drawing and typing always produce the same
 * blueprint. Removing something also removes whatever pointed at it, so an
 * edit never leaves a dangling reference behind.
 */

export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 96;
export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 560;

function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 44)}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

export function addType(bp: Blueprint, name: LocalizedText): Blueprint {
  const key = uniqueKey(keyFromName(name.en), bp.types.map((t) => t.key));
  const n = bp.types.length;
  const layout = {
    x: clamp(40 + (n % 4) * (CARD_WIDTH + 60), CANVAS_WIDTH - CARD_WIDTH),
    y: clamp(40 + Math.floor(n / 4) * (CARD_HEIGHT + 80), CANVAS_HEIGHT - CARD_HEIGHT),
  };
  return { ...bp, types: [...bp.types, { key, name, properties: [], layout }] };
}

export function updateType(bp: Blueprint, key: string, patch: Partial<Pick<BlueprintType, "name" | "key" | "icon">>): Blueprint {
  const nextKey = patch.key ?? key;
  const rename = (k: string) => (k === key ? nextKey : k);
  return {
    ...bp,
    types: bp.types.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    relations: bp.relations.map((r) => ({ ...r, from: rename(r.from), to: rename(r.to) })),
    lenses: bp.lenses.map((l) => ({ ...l, type: rename(l.type) })),
    forms: bp.forms.map((f) => ({ ...f, type: rename(f.type) })),
    workflows: bp.workflows.map((w) => ({ ...w, type: rename(w.type) })),
  };
}

export function moveType(bp: Blueprint, key: string, x: number, y: number): Blueprint {
  const layout = { x: clamp(x, CANVAS_WIDTH - CARD_WIDTH), y: clamp(y, CANVAS_HEIGHT - CARD_HEIGHT) };
  return { ...bp, types: bp.types.map((t) => (t.key === key ? { ...t, layout } : t)) };
}

export function removeType(bp: Blueprint, key: string): Blueprint {
  const goneRelations = new Set(bp.relations.filter((r) => r.from === key || r.to === key).map((r) => r.key));
  return {
    ...bp,
    types: bp.types
      .filter((t) => t.key !== key)
      .map((t) => ({
        ...t,
        properties: t.properties.filter((p) => !(p.relation && goneRelations.has(p.relation))),
      })),
    relations: bp.relations.filter((r) => !goneRelations.has(r.key)),
    lenses: bp.lenses.filter((l) => l.type !== key),
    forms: bp.forms.filter((f) => f.type !== key),
    workflows: bp.workflows.filter((w) => w.type !== key),
  };
}

export function addProperty(bp: Blueprint, typeKey: string, name: LocalizedText): Blueprint {
  return {
    ...bp,
    types: bp.types.map((t) =>
      t.key === typeKey
        ? {
            ...t,
            properties: [
              ...t.properties,
              { key: uniqueKey(keyFromName(name.en), ["title", ...t.properties.map((p) => p.key)]), name, kind: "text" },
            ],
          }
        : t,
    ),
  };
}

/**
 * Changing the kind drops settings that belong to the old kind and seeds the
 * ones the new kind needs, so the property stays valid where it can.
 */
export function updateProperty(
  bp: Blueprint,
  typeKey: string,
  propertyKey: string,
  patch: Partial<BlueprintProperty>,
): Blueprint {
  return {
    ...bp,
    types: bp.types.map((t) => {
      if (t.key !== typeKey) return t;
      return {
        ...t,
        properties: t.properties.map((p) => {
          if (p.key !== propertyKey) return p;
          const next: BlueprintProperty = { ...p, ...patch };
          if (patch.kind && patch.kind !== p.kind) {
            const choices = ["status", "select", "multi_select"].includes(patch.kind);
            next.choices = choices ? p.choices ?? [] : undefined;
            next.currency = patch.kind === "currency" ? p.currency ?? "CAD" : undefined;
            next.relation =
              patch.kind === "relation"
                ? bp.relations.find((r) => r.from === typeKey || r.to === typeKey)?.key
                : undefined;
          }
          return next;
        }),
      };
    }),
  };
}

export function removeProperty(bp: Blueprint, typeKey: string, propertyKey: string): Blueprint {
  return {
    ...bp,
    types: bp.types.map((t) =>
      t.key === typeKey ? { ...t, properties: t.properties.filter((p) => p.key !== propertyKey) } : t,
    ),
    lenses: bp.lenses.map((l) =>
      l.type === typeKey && l.groupBy === propertyKey ? { ...l, groupBy: undefined } : l,
    ),
    forms: bp.forms.map((f) => (f.type === typeKey ? { ...f, fields: f.fields.filter((k) => k !== propertyKey) } : f)),
  };
}

export function moveProperty(bp: Blueprint, typeKey: string, propertyKey: string, offset: -1 | 1): Blueprint {
  return {
    ...bp,
    types: bp.types.map((t) => {
      if (t.key !== typeKey) return t;
      const index = t.properties.findIndex((p) => p.key === propertyKey);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= t.properties.length) return t;
      const properties = [...t.properties];
      [properties[index], properties[target]] = [properties[target], properties[index]];
      return { ...t, properties };
    }),
  };
}

export function addRelation(
  bp: Blueprint,
  from: string,
  to: string,
  name: LocalizedText,
  reverseName: LocalizedText,
): Blueprint {
  const key = uniqueKey(keyFromName(`${from}_${to}`), bp.relations.map((r) => r.key));
  const relation: BlueprintRelation = { key, from, to, name, reverseName, cardinality: "many_to_many" };
  return { ...bp, relations: [...bp.relations, relation] };
}

export function updateRelation(bp: Blueprint, key: string, patch: Partial<BlueprintRelation>): Blueprint {
  const nextKey = patch.key ?? key;
  return {
    ...bp,
    relations: bp.relations.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    types: bp.types.map((t) => ({
      ...t,
      properties: t.properties.map((p) => (p.relation === key ? { ...p, relation: nextKey } : p)),
    })),
  };
}

export function removeRelation(bp: Blueprint, key: string): Blueprint {
  return {
    ...bp,
    relations: bp.relations.filter((r) => r.key !== key),
    types: bp.types.map((t) => ({ ...t, properties: t.properties.filter((p) => p.relation !== key) })),
  };
}

/** Choices typed one per line as "English | French". */
export function parseChoices(text: string): BlueprintProperty["choices"] {
  const taken: string[] = [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [en, fr] = line.split("|").map((part) => part.trim());
      const key = uniqueKey(keyFromName(en ?? ""), taken);
      taken.push(key);
      return { key, label: { en: en ?? "", fr: fr || en || "" } };
    });
}

export function formatChoices(choices: BlueprintProperty["choices"]): string {
  return (choices ?? []).map((c) => `${c.label.en} | ${c.label.fr}`).join("\n");
}

/** Where a relation line starts and ends: the centres of its two cards. */
export function relationLine(bp: Blueprint, relation: BlueprintRelation) {
  const from = bp.types.find((t) => t.key === relation.from)?.layout;
  const to = bp.types.find((t) => t.key === relation.to)?.layout;
  if (!from || !to) return null;
  return {
    x1: from.x + CARD_WIDTH / 2,
    y1: from.y + CARD_HEIGHT / 2,
    x2: to.x + CARD_WIDTH / 2,
    y2: to.y + CARD_HEIGHT / 2,
  };
}
