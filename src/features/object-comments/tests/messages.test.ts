import { describe, expect, it } from "vitest";
import { fill, leafPaths } from "@/features/collab/i18n";
import { objectCommentsEn } from "../messages.en";
import { objectCommentsFr } from "../messages.fr-CA";
import { objectCommentsText } from "../messages";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function leaf(node: unknown, path: string): string {
  return path.split(".").reduce((value, key) => (value as Record<string, unknown>)[key], node) as string;
}

describe("object comment text", () => {
  it("has every English key in French, none empty, with the same placeholders", () => {
    const en = leafPaths(objectCommentsEn);
    expect(leafPaths(objectCommentsFr)).toEqual(en);
    for (const path of en) {
      const fr = leaf(objectCommentsFr, path);
      expect(fr.trim(), path).not.toBe("");
      expect(placeholders(fr), path).toEqual(placeholders(leaf(objectCommentsEn, path)));
    }
  });

  it("picks the reader's language", () => {
    expect(objectCommentsText("fr-CA").heading).toBe("Commentaires");
    expect(objectCommentsText("en").heading).toBe("Comments");
  });

  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fill("{name} said {what}", { name: "Ada" })).toBe("Ada said {what}");
    expect(fill("{count} open", { count: 3 })).toBe("3 open");
  });
});
