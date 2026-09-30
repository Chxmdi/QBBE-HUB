import { describe, expect, it } from "vitest";
import * as edit from "../editor-state";
import { emptyBlueprint, validateBlueprint, type Blueprint } from "../schema";

const en = (text: string) => ({ en: text, fr: text });

function twoTypes(): Blueprint {
  let bp = edit.addType(emptyBlueprint(), en("Opening"));
  bp = edit.addProperty(bp, "opening", en("Stage"));
  bp = edit.updateProperty(bp, "opening", "stage", { kind: "status" });
  bp = edit.updateProperty(bp, "opening", "stage", { choices: edit.parseChoices("Open | Ouvert\nFilled | Pourvu") });
  return edit.addRelation(bp, "item", "opening", en("fills"), en("filled by"));
}

describe("editor state", () => {
  it("adds types with unique keys and places them inside the canvas", () => {
    let bp = emptyBlueprint();
    for (let i = 0; i < 12; i += 1) bp = edit.addType(bp, en("Item"));
    expect(new Set(bp.types.map((t) => t.key)).size).toBe(13);
    for (const t of bp.types) {
      expect(t.layout!.x).toBeLessThanOrEqual(edit.CANVAS_WIDTH - edit.CARD_WIDTH);
      expect(t.layout!.y).toBeLessThanOrEqual(edit.CANVAS_HEIGHT - edit.CARD_HEIGHT);
    }
  });

  it("builds a valid blueprint from edits alone", () => {
    expect(validateBlueprint(twoTypes()).ok).toBe(true);
  });

  it("keeps moves on the canvas", () => {
    const bp = edit.moveType(twoTypes(), "opening", -50, 99999);
    expect(bp.types[1].layout).toEqual({ x: 0, y: edit.CANVAS_HEIGHT - edit.CARD_HEIGHT });
  });

  it("renaming a type key follows through to relations", () => {
    const bp = edit.updateType(twoTypes(), "opening", { key: "job" });
    expect(bp.relations[0].to).toBe("job");
    expect(validateBlueprint(bp).ok).toBe(true);
  });

  it("removing a type removes its relations and the properties that used them", () => {
    let bp = twoTypes();
    bp = edit.addProperty(bp, "opening", en("Filled by"));
    bp = edit.updateProperty(bp, "opening", "filled_by", { kind: "relation" });
    expect(bp.types[1].properties[1].relation).toBe(bp.relations[0].key);
    bp = edit.removeType(bp, "item");
    expect(bp.relations).toEqual([]);
    expect(bp.types[0].properties.map((p) => p.key)).toEqual(["stage"]);
    expect(validateBlueprint(bp).ok).toBe(true);
  });

  it("changing kind clears settings of the old kind", () => {
    const bp = edit.updateProperty(twoTypes(), "opening", "stage", { kind: "currency" });
    expect(bp.types[1].properties[0]).toMatchObject({ kind: "currency", currency: "CAD", choices: undefined });
  });

  it("moves properties up and down within bounds", () => {
    let bp = edit.addProperty(twoTypes(), "opening", en("Salary"));
    bp = edit.moveProperty(bp, "opening", "salary", -1);
    expect(bp.types[1].properties.map((p) => p.key)).toEqual(["salary", "stage"]);
    expect(edit.moveProperty(bp, "opening", "salary", -1)).toEqual(bp);
  });

  it("parses and formats choices in both languages", () => {
    const choices = edit.parseChoices("Open | Ouvert\n\nOpen\n");
    expect(choices).toEqual([
      { key: "open", label: { en: "Open", fr: "Ouvert" } },
      { key: "open_2", label: { en: "Open", fr: "Open" } },
    ]);
    expect(edit.formatChoices(choices)).toBe("Open | Ouvert\nOpen | Open");
  });

  it("draws relation lines between card centres", () => {
    const bp = twoTypes();
    const line = edit.relationLine(bp, bp.relations[0]);
    expect(line).toEqual({
      x1: bp.types[0].layout!.x + edit.CARD_WIDTH / 2,
      y1: bp.types[0].layout!.y + edit.CARD_HEIGHT / 2,
      x2: bp.types[1].layout!.x + edit.CARD_WIDTH / 2,
      y2: bp.types[1].layout!.y + edit.CARD_HEIGHT / 2,
    });
  });
});
