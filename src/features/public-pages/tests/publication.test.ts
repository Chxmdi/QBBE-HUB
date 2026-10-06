import { describe, expect, it } from "vitest";
import { catalogueLeaves } from "@/features/spaces/i18n/translator";
import { publicPagesEn } from "../i18n/en";
import { publicPagesFr } from "../i18n/fr-CA";
import { fieldLabel, fieldValue, isValidSlug, toSlug } from "../services/publication";

describe("web addresses", () => {
  it("turn a name into a valid address", () => {
    expect(toSlug("Congrès annuel 2026 — Montréal!")).toBe("congres-annuel-2026-montreal");
    expect(isValidSlug(toSlug("Congrès annuel 2026 — Montréal!"))).toBe(true);
  });
  it("match the database's rule", () => {
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("-abc")).toBe(false);
    expect(isValidSlug("Abc")).toBe(false);
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("a".repeat(81))).toBe(false);
  });
});

describe("published fields", () => {
  const space = { key: "title", label_en: "Name", label_fr: "Nom", value_en: "Board", value_fr: "Conseil" };
  const plain = { key: "description", label_en: "Description", label_fr: "Description", value: "Hello" };
  it("read in the visitor's language", () => {
    expect(fieldValue(space, "fr-CA")).toBe("Conseil");
    expect(fieldValue(space, "en")).toBe("Board");
    expect(fieldValue(plain, "fr-CA")).toBe("Hello");
    expect(fieldLabel(space, "fr-CA")).toBe("Nom");
  });
  it("treat empty values as nothing to show", () => {
    expect(fieldValue({ ...plain, value: "" }, "en")).toBeNull();
    expect(fieldValue({ ...plain, value: null }, "en")).toBeNull();
  });
});

describe("public pages catalogues", () => {
  const en = new Map(catalogueLeaves(publicPagesEn));
  const fr = new Map(catalogueLeaves(publicPagesFr));
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  it("match key for key, with the same placeholders and real French", () => {
    expect([...fr.keys()].sort()).toEqual([...en.keys()].sort());
    for (const [key, english] of en) {
      const french = fr.get(key) ?? "";
      expect(french.trim(), key).not.toBe("");
      expect(placeholders(french), key).toEqual(placeholders(english));
      expect(french, key).not.toBe(english);
    }
  });
});
