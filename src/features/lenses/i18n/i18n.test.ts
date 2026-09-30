import { describe, expect, it } from "vitest";
import { createLensT, lensesEn, lensesFrCA } from "./index";

function leaves(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

describe("lens strings", () => {
  it("French has every English key with the same placeholders", () => {
    const fr = new Map(leaves(lensesFrCA));
    for (const [key, text] of leaves(lensesEn)) {
      const french = fr.get(key);
      expect(french, key).toBeTruthy();
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(vars(french!), key).toEqual(vars(text));
    }
  });

  it("interpolates", () => {
    expect(createLensT("fr-CA")("table.saveFailed", { reason: "x" })).toBe("Non enregistré : x");
  });
});
