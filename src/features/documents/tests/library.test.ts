import { describe, expect, it } from "vitest";
import {
  folderLabel,
  groupFolders,
  likePattern,
  parseTags,
} from "@/features/documents/services/library";

describe("parseTags", () => {
  it("trims, lower-cases, drops blanks and duplicates", () => {
    expect(parseTags(" Policy, conduct ,, POLICY ")).toEqual(["policy", "conduct"]);
  });

  it("accepts an array and treats empty input as no tags", () => {
    expect(parseTags(["HR", "hr"])).toEqual(["hr"]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags(undefined)).toEqual([]);
  });
});

describe("likePattern", () => {
  it("matches the words anywhere, case-insensitively", () => {
    expect(likePattern("  Board Minutes ")).toBe("%board minutes%");
  });

  it("treats wildcard characters as literal text", () => {
    expect(likePattern("100%_done\\")).toBe("%100\\%\\_done\\\\%");
  });
});

describe("folders", () => {
  it("labels a folder with its category", () => {
    expect(folderLabel({ category: "governance", name: "Bylaws" })).toBe("Governance / Bylaws");
  });

  it("groups folders in category order and sorts names", () => {
    const groups = groupFolders([
      { category: "hr", name: "Personnel" },
      { category: "governance", name: "Policies" },
      { category: "governance", name: "Bylaws" },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Governance", "HR"]);
    expect(groups[0].folders.map((f) => f.name)).toEqual(["Bylaws", "Policies"]);
  });
});

describe("folders in French", () => {
  it("labels categories and refuses too many tags in French", async () => {
    const { createTranslator } = await import("@/lib/i18n/translate");
    const { tagsSchemaFor } = await import("@/features/documents/services/library");
    const t = createTranslator("fr-CA");
    expect(folderLabel({ category: "governance", name: "Bylaws" }, t)).toBe("Gouvernance / Bylaws");
    const result = tagsSchemaFor(t).safeParse(Array.from({ length: 13 }, (_, i) => `t${i}`));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Utilisez au plus 12 étiquettes.");
  });
});
