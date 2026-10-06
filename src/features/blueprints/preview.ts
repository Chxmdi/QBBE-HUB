import type { LocalizedText } from "@/lib/objects/contracts";
import type { Blueprint, BlueprintType } from "./schema";

/**
 * What building a blueprint will create, shown on the preview step before
 * anyone approves it. Anything the blueprint does not list itself gets a
 * sensible default: every type gets a table and a form, and a type with a
 * status or select property gets a board grouped by it.
 */

export type PreviewSource = "blueprint" | "default";

export interface PreviewLens {
  key: string;
  type: string;
  kind: Blueprint["lenses"][number]["kind"];
  name: LocalizedText;
  groupBy: string | null;
  source: PreviewSource;
}

export interface PreviewForm {
  key: string;
  type: string;
  name: LocalizedText;
  fields: string[];
  source: PreviewSource;
}

export interface BlueprintPreview {
  types: BlueprintType[];
  relations: Blueprint["relations"];
  lenses: PreviewLens[];
  forms: PreviewForm[];
  workflows: Blueprint["workflows"];
}

function boardProperty(type: BlueprintType) {
  return (
    type.properties.find((p) => p.kind === "status") ??
    type.properties.find((p) => p.kind === "select")
  );
}

export function previewBlueprint(blueprint: Blueprint): BlueprintPreview {
  const lenses: PreviewLens[] = blueprint.lenses.map((lens) => ({
    ...lens,
    groupBy: lens.groupBy ?? null,
    source: "blueprint",
  }));
  const forms: PreviewForm[] = blueprint.forms.map((form) => ({ ...form, source: "blueprint" }));
  const taken = new Set([...lenses.map((l) => l.key), ...forms.map((f) => f.key)]);
  const unique = (base: string) => {
    let candidate = base;
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}_${n}`;
    taken.add(candidate);
    return candidate;
  };

  for (const type of blueprint.types) {
    const own = lenses.filter((lens) => lens.type === type.key);
    if (!own.some((lens) => lens.kind === "table")) {
      lenses.push({
        key: unique(`${type.key}_table`),
        type: type.key,
        kind: "table",
        name: { en: `All ${type.name.en}`, fr: `${type.name.fr} : tout` },
        groupBy: null,
        source: "default",
      });
    }
    const group = boardProperty(type);
    if (group && !own.some((lens) => lens.kind === "board")) {
      lenses.push({
        key: unique(`${type.key}_board`),
        type: type.key,
        kind: "board",
        name: { en: `${type.name.en} by ${group.name.en}`, fr: `${type.name.fr} par ${group.name.fr}` },
        groupBy: group.key,
        source: "default",
      });
    }
    if (!forms.some((form) => form.type === type.key)) {
      forms.push({
        key: unique(`${type.key}_form`),
        type: type.key,
        name: { en: `New ${type.name.en}`, fr: `${type.name.fr} : nouveau` },
        fields: ["title", ...type.properties.filter((p) => p.kind !== "relation").map((p) => p.key)],
        source: "default",
      });
    }
  }

  return {
    types: blueprint.types,
    relations: blueprint.relations,
    lenses,
    forms,
    workflows: blueprint.workflows,
  };
}
