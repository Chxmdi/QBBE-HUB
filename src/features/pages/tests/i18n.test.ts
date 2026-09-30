import { describe, expect, it } from "vitest";
import { createPagesT, pagesEn, pagesFrCA } from "@/features/pages/i18n";

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`),
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// Words spelled the same in both languages.
const SAME_IN_BOTH = new Set(["meta.title", "home.title", "sidebar.label", "covers.accent"]);

describe("pages dictionaries", () => {
  const en = new Map(leaves(pagesEn as unknown as Tree));
  const fr = new Map(leaves(pagesFrCA as unknown as Tree));

  it("have the same keys", () => {
    expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it("have no empty strings", () => {
    expect([...en, ...fr].filter(([, text]) => text.trim() === "")).toEqual([]);
  });

  it("keep the same placeholders in both languages", () => {
    const differing = [...en].filter(([key, text]) => placeholders(text).join() !== placeholders(fr.get(key) ?? "").join());
    expect(differing).toEqual([]);
  });

  it("translate every string rather than copying the English", () => {
    const copied = [...en].filter(([key, text]) => fr.get(key) === text && !SAME_IN_BOTH.has(key)).map(([key]) => key);
    expect(copied).toEqual([]);
  });

  it("interpolate and fall back", () => {
    expect(createPagesT("fr-CA")("sidebar.expand", { title: "Guide" })).toBe("Déplier Guide");
    expect(createPagesT("en")("copySuffix", { title: "Plan" })).toBe("Plan (copy)");
  });
});
