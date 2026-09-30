import { describe, expect, it } from "vitest";
import { leafPaths } from "@/features/collab/i18n";
import { taskSystemProperties } from "@/lib/objects/stubs";
import {
  defaultLayout,
  freshSectionId,
  hiddenProperties,
  layoutSchema,
  move,
  normalizeLayout,
  readLayout,
  type ObjectLayout,
} from "../layout";
import { layoutsEn } from "../messages.en";
import { layoutsFr } from "../messages.fr-CA";

const catalog = { properties: ["title", "status", "due"], relations: ["project"] };

describe("layouts", () => {
  it("default: every property, content, each related list, comments", () => {
    const layout = defaultLayout(catalog);
    expect(layout.sections.map((s) => s.kind)).toEqual(["properties", "content", "related", "comments"]);
    expect(hiddenProperties(layout, catalog)).toEqual([]);
    expect(layoutSchema.safeParse(layout).success).toBe(true);
  });

  it("drops properties and relations that no longer exist, and duplicates", () => {
    const stored: ObjectLayout = {
      version: 1,
      sections: [
        { id: "a", kind: "properties", properties: ["status", "gone", "status"] },
        { id: "b", kind: "properties", properties: ["status", "due"] },
        { id: "c", kind: "related", relation: "gone", limit: 5 },
      ],
    };
    const normalized = normalizeLayout(stored, catalog);
    expect(normalized.sections).toEqual([
      { id: "a", kind: "properties", properties: ["status"] },
      { id: "b", kind: "properties", properties: ["due"] },
    ]);
    expect(hiddenProperties(normalized, catalog)).toEqual(["title"]);
  });

  it("falls back to the default for anything unreadable", () => {
    expect(readLayout({ version: 2 }, catalog)).toEqual(defaultLayout(catalog));
    expect(readLayout(null, catalog)).toEqual(defaultLayout(catalog));
    const dup = { version: 1, sections: [{ id: "x", kind: "content" }, { id: "x", kind: "comments" }] };
    expect(layoutSchema.safeParse(dup).success).toBe(false);
  });

  it("moves items up and down, ignoring moves off the ends", () => {
    expect(move(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });

  it("gives new sections unused ids", () => {
    const layout = defaultLayout(catalog);
    expect(freshSectionId(layout, "content")).toBe("content-2");
    expect(freshSectionId(layout, "versions")).toBe("versions");
  });
});

describe("layout text", () => {
  it("names every task property, in both languages with the same placeholders", () => {
    for (const key of Object.keys(taskSystemProperties)) expect(layoutsEn.properties).toHaveProperty(key);
    expect(leafPaths(layoutsFr)).toEqual(leafPaths(layoutsEn));
    const get = (node: unknown, path: string) =>
      path.split(".").reduce((value, key) => (value as Record<string, unknown>)[key], node) as string;
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const path of leafPaths(layoutsEn)) {
      expect(get(layoutsFr, path).trim(), path).not.toBe("");
      expect(holes(get(layoutsFr, path)), path).toEqual(holes(get(layoutsEn, path)));
    }
  });
});
