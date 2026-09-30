import { describe, expect, it } from "vitest";
import { nativeObjectTypeKeys } from "@/lib/objects/contracts";
import { findConflicts, planBlueprint } from "../plan";
import { previewBlueprint } from "../preview";
import { validateBlueprint, type Blueprint } from "../schema";
import { starterBlueprints } from "../starters";

const validated: Blueprint[] = starterBlueprints.map((json) => {
  const result = validateBlueprint(json);
  if (!result.ok) throw new Error(`${(json as { key: string }).key}: ${JSON.stringify(result.issues)}`);
  return result.blueprint;
});

describe("starter blueprints", () => {
  it("are the six QBBE asked for", () => {
    expect(validated.map((bp) => bp.key)).toEqual([
      "recruiting",
      "volunteer_intake",
      "event_planning",
      "grant",
      "donor_stewardship",
      "inventory",
    ]);
  });

  it.each(starterBlueprints.map((json) => [(json as { key: string }).key, json]))("%s validates against the schema", (_key, json) => {
    const result = validateBlueprint(json);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it.each(validated.map((bp) => [bp.key, bp] as const))("%s has English and French for every piece of text", (_key, bp) => {
    const texts: { en: string; fr: string }[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if (typeof record.en === "string" && typeof record.fr === "string") texts.push(record as { en: string; fr: string });
        else Object.values(record).forEach(walk);
      }
    };
    walk(bp);
    expect(texts.length).toBeGreaterThan(10);
    for (const text of texts) {
      expect(text.en.trim()).not.toBe("");
      expect(text.fr.trim()).not.toBe("");
    }
    expect(bp.description.en).not.toBe(bp.description.fr);
  });

  it.each(validated.map((bp) => [bp.key, bp] as const))("%s previews and plans a view, a form and a card for every type", (_key, bp) => {
    const preview = previewBlueprint(bp);
    for (const type of bp.types) {
      expect(preview.lenses.some((l) => l.type === type.key)).toBe(true);
      expect(preview.forms.some((f) => f.type === type.key)).toBe(true);
      expect(type.layout).toBeDefined();
    }
    const plan = planBlueprint(bp, () => "id");
    expect(plan.counts.object_type).toBe(bp.types.length);
    expect(plan.counts.workflow).toBe(bp.workflows.length);
  });

  it("never reuse a native type key, and can all be built side by side", () => {
    const types: string[] = [];
    const relations: string[] = [];
    for (const bp of validated) {
      expect(findConflicts(bp, { types, relations })).toEqual([]);
      types.push(...bp.types.map((t) => t.key));
      relations.push(...bp.relations.map((r) => r.key));
    }
    expect(types.filter((key) => (nativeObjectTypeKeys as readonly string[]).includes(key))).toEqual([]);
  });

  it("keep cards inside the canvas without overlapping", () => {
    for (const bp of validated) {
      const boxes = bp.types.map((t) => t.layout!);
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b) => {
          const overlap = Math.abs(a.x - b.x) < 200 && Math.abs(a.y - b.y) < 96;
          expect(overlap, `${bp.key}: cards overlap`).toBe(false);
        }),
      );
    }
  });
});
