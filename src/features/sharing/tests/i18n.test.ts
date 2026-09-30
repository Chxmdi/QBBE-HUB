import { describe, expect, it } from "vitest";
import { catalogueLeaves } from "@/features/spaces/i18n/translator";
import { sharingEn } from "../i18n/en";
import { sharingFr } from "../i18n/fr-CA";

describe("sharing catalogues", () => {
  const en = new Map(catalogueLeaves(sharingEn));
  const fr = new Map(catalogueLeaves(sharingFr));
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("have the same keys", () => {
    expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it("have no empty string, matching placeholders, and real French", () => {
    for (const [key, english] of en) {
      const french = fr.get(key) ?? "";
      expect(english.trim(), key).not.toBe("");
      expect(french.trim(), key).not.toBe("");
      expect(placeholders(french), key).toEqual(placeholders(english));
      expect(french, key).not.toBe(english);
    }
  });
});
