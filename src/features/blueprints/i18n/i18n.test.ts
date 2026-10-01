import { describe, expect, it } from "vitest";
import { blueprintsEn } from "./en";
import { blueprintsFrCA } from "./fr-CA";

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("blueprint strings", () => {
  it("French has every English key, not blank, with the same placeholders", () => {
    const fr = new Map(leaves(blueprintsFrCA));
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, text] of leaves(blueprintsEn)) {
      const french = fr.get(key);
      expect(french?.trim(), key).toBeTruthy();
      expect(vars(french!), key).toEqual(vars(text));
    }
  });
});
