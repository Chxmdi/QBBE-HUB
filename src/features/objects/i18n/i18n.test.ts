import { describe, expect, it } from "vitest";
import { objectsEn } from "./en";
import { objectsFr } from "./fr-CA";
import { createObjectsTranslator } from "./translate";

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("object layer catalogues", () => {
  const english = flatten(objectsEn);
  const french = flatten(objectsFr);

  it("have the same keys, no empty strings and the same placeholders", () => {
    expect([...french.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of [...english, ...french]) expect(value.trim(), key).not.toBe("");
    for (const [key, value] of english) expect(placeholders(french.get(key) ?? ""), key).toEqual(placeholders(value));
  });

  it("translates with placeholders in each language", () => {
    expect(createObjectsTranslator("en")("related.count", { count: 3 })).toBe("3 linked");
    expect(createObjectsTranslator("fr-CA")("related.count", { count: 3 })).toBe("3 liés");
  });
});
