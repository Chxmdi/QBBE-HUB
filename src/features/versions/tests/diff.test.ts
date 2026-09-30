import { describe, expect, it } from "vitest";
import type { ContentSnapshot } from "../content";
import { diffSnapshots, diffText, restoreBlockInto } from "../diff";

const block = (id: string, text: string) => ({ id, type: "paragraph", text });
const content = (...blocks: ReturnType<typeof block>[]): ContentSnapshot => ({ version: 1, blocks });

describe("word diff", () => {
  it("marks added and removed words and rebuilds both texts", () => {
    const parts = diffText("Plan the gala dinner.", "Plan the spring gala dinner with sponsors.");
    const before = parts.filter((p) => p.kind !== "added").map((p) => p.text).join("");
    const after = parts.filter((p) => p.kind !== "removed").map((p) => p.text).join("");
    expect(before).toBe("Plan the gala dinner.");
    expect(after).toBe("Plan the spring gala dinner with sponsors.");
    expect(parts.filter((p) => p.kind === "added").map((p) => p.text.trim())).toEqual(["spring", "dinner with sponsors."]);
    expect(parts.find((p) => p.kind === "removed")?.text).toBe("dinner.");
  });

  it("handles empty sides and identical text", () => {
    expect(diffText("", "")).toEqual([]);
    expect(diffText("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    expect(diffText("", "new")).toEqual([{ kind: "added", text: "new" }]);
    expect(diffText("old", "")).toEqual([{ kind: "removed", text: "old" }]);
  });
});

describe("snapshot diff", () => {
  it("lines blocks up by id and keeps removed blocks where they were", () => {
    const diff = diffSnapshots(
      { content: content(block("a", "one"), block("b", "two"), block("c", "three")), properties: { status: "todo", due: null } },
      { content: content(block("a", "one"), block("c", "three!"), block("d", "four")), properties: { status: "done", due: null } },
    );
    expect(diff.blocks.map((b) => `${b.kind}:${b.id}`)).toEqual(["same:a", "removed:b", "changed:c", "added:d"]);
    expect(diff.properties).toEqual([
      { key: "status", before: "todo", after: "done", changed: true },
      { key: "due", before: null, after: null, changed: false },
    ]);
    expect(diff.changedCount).toBe(4);
  });

  it("reports no changes for identical snapshots", () => {
    const same = { content: content(block("a", "x")), properties: { title: "T" } };
    expect(diffSnapshots(same, same).changedCount).toBe(0);
  });
});

describe("restoring one block", () => {
  const version = content(block("a", "A"), block("b", "B old"), block("c", "C"));

  it("replaces a block in place", () => {
    const current = content(block("a", "A"), block("b", "B new"), block("c", "C2"));
    expect(restoreBlockInto(current, version, "b").blocks).toEqual([block("a", "A"), block("b", "B old"), block("c", "C2")]);
  });

  it("puts a deleted block back after the block that preceded it", () => {
    const current = content(block("a", "A"), block("c", "C"));
    expect(restoreBlockInto(current, version, "b").blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(restoreBlockInto(content(block("c", "C")), version, "a").blocks.map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("refuses a block the version does not have", () => {
    expect(() => restoreBlockInto(version, version, "zzz")).toThrow("block_not_in_version");
  });
});
