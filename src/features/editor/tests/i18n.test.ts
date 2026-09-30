import { describe, expect, it } from "vitest";
import { createEditorT, editorEn, editorFrCA } from "@/features/editor/i18n";

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();

// Product names and words spelled the same in both languages.
const SAME = new Set(["embed.placeholder"]);

describe("editor dictionaries", () => {
  const en = new Map(leaves(editorEn as unknown as Tree));
  const fr = new Map(leaves(editorFrCA as unknown as Tree));

  it("match key for key, with no empty strings", () => {
    expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
    expect([...en, ...fr].filter(([, v]) => !v.trim())).toEqual([]);
  });

  it("keep placeholders and translate every string", () => {
    expect([...en].filter(([k, v]) => placeholders(v) !== placeholders(fr.get(k)!))).toEqual([]);
    expect([...en].filter(([k, v]) => fr.get(k) === v && !SAME.has(k)).map(([k]) => k)).toEqual([]);
  });

  it("interpolates", () => {
    expect(createEditorT("fr-CA")("blockMenu.turnInto", { type: "Citation" })).toBe("Transformer en Citation");
  });
});
