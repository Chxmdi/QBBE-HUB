import { describe, expect, it } from "vitest";
import { spacesEn } from "../i18n/en";
import { spacesFr } from "../i18n/fr-CA";
import { catalogueLeaves, moduleTranslator } from "../i18n/translator";

/**
 * The same rules src/lib/i18n/i18n.test.ts applies to the shared catalogues:
 * nothing empty, the same placeholders in both, and no English copied across.
 */
const SAME_IN_BOTH = new Set<string>([]);

describe("spaces catalogues", () => {
  const en = new Map(catalogueLeaves(spacesEn));
  const fr = new Map(catalogueLeaves(spacesFr));
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
      if (!SAME_IN_BOTH.has(key)) expect(french, key).not.toBe(english);
    }
  });

  it("translate by dotted key, falling back to English", () => {
    expect(moduleTranslator<typeof spacesEn>({ en: spacesEn, "fr-CA": spacesFr }, "fr-CA")("sections.private")).toBe(
      "Votre espace privé",
    );
    const partial = { ...spacesFr, archived: undefined as unknown as string };
    expect(moduleTranslator<typeof spacesEn>({ en: spacesEn, "fr-CA": partial }, "fr-CA")("archived")).toBe("Archived");
  });
});
