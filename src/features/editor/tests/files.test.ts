import { describe, expect, it } from "vitest";
import { documentIdFromRef, documentRef, storagePathFor } from "@/features/editor/adapter/files";

describe("file references", () => {
  const id = "0b7c8f3e-1d2a-4b5c-9e8f-7a6b5c4d3e2f";

  it("round-trip a document id", () => {
    expect(documentIdFromRef(documentRef(id))).toBe(id);
  });

  it("reject anything that is not a document reference", () => {
    expect(documentIdFromRef("https://example.org/a.png")).toBeNull();
    expect(documentIdFromRef("qbbe-document:../../etc")).toBeNull();
    expect(documentIdFromRef(null)).toBeNull();
  });

  it("make safe storage paths", () => {
    const path = storagePathFor("Rapport d'été (final).pdf", "r");
    expect(path.startsWith("r/Rapport_d_")).toBe(true);
    expect(path).toMatch(/^r\/[A-Za-z0-9._-]+\.pdf$/);
    expect(storagePathFor("", "r")).toBe("r/file");
  });
});
