import { describe, expect, it } from "vitest";
import { createEditorT } from "@/features/editor/i18n";
import { editorEn } from "@/features/editor/i18n/en";
import { editorFrCA } from "@/features/editor/i18n/fr-CA";
import { joinNames, pageIdFromPath } from "./c1-presence";

describe("C1 editor unit", () => {
  it("takes part only on pages", () => {
    expect(pageIdFromPath("/pages/AAAAAAAA-aaaa-aaaa-aaaa-aaaaaaaaaaa1")).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1");
    expect(pageIdFromPath(undefined)).toBeNull();
    expect(pageIdFromPath("/tasks/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1")).toBeNull();
    expect(pageIdFromPath("/pages/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1/x")).toBeNull();
  });

  it("joins names in each language", () => {
    expect(joinNames(["Ann"], createEditorT("en"))).toBe("Ann");
    expect(joinNames(["Ann", "Bo", "Cy"], createEditorT("en"))).toBe("Ann, Bo and Cy");
    expect(joinNames(["Ann", "Bo"], createEditorT("fr-CA"))).toBe("Ann et Bo");
  });

  it("has the same strings in English and French", () => {
    const keys = (o: object): string[] => Object.keys(o).sort();
    expect(keys(editorFrCA.units.c1)).toEqual(keys(editorEn.units.c1));
  });
});
