import { describe, expect, it } from "vitest";
import { columnFixes } from "@/features/editor/adapter/columns";
import type { EditorBlock } from "@/features/editor/adapter/content";

const p = (id: string): EditorBlock => ({ id, type: "paragraph", content: [{ type: "text", text: id }] });
const col = (id: string, children: EditorBlock[], width = 1): EditorBlock => ({ id, type: "column", props: { width }, children });
const list = (id: string, children: EditorBlock[]): EditorBlock => ({ id, type: "columnList", props: {}, children });

describe("columnFixes", () => {
  it("leaves a well-formed document alone", () => {
    expect(columnFixes([p("a"), list("l", [col("c1", [p("x")]), col("c2", [p("y")], 2)]), p("b")])).toEqual([]);
  });

  it("gathers a loose block into the column before it", () => {
    const [fix] = columnFixes([list("l", [col("c1", [p("x")]), p("loose"), col("c2", [p("y")])])]);
    expect(fix.kind).toBe("rewrap");
    expect(fix.kind === "rewrap" && fix.children.map((c) => [c.id, c.children?.map((b) => b.id)])).toEqual([
      ["c1", ["x", "loose"]],
      ["c2", ["y"]],
    ]);
  });

  it("puts leading loose blocks at the start of the first column", () => {
    const [fix] = columnFixes([list("l", [p("first"), col("c1", [p("x")]), col("c2", [p("y")])])]);
    expect(fix.kind === "rewrap" && fix.children[0].children?.map((b) => b.id)).toEqual(["first", "x"]);
  });

  it("gives an empty column a paragraph", () => {
    const [fix] = columnFixes([list("l", [col("c1", []), col("c2", [p("y")])])]);
    expect(fix.kind === "rewrap" && fix.children[0].children).toEqual([{ type: "paragraph" }]);
  });

  it("unwraps a list left with one column, and removes an empty list", () => {
    expect(columnFixes([list("l", [col("c1", [p("x")])])])).toEqual([{ kind: "unwrap", id: "l", blocks: [p("x")] }]);
    expect(columnFixes([list("l", [])])).toEqual([{ kind: "unwrap", id: "l", blocks: [] }]);
  });

  it("unwraps a column outside a column list, at any depth", () => {
    expect(columnFixes([col("c", [p("x")])])).toEqual([{ kind: "unwrap", id: "c", blocks: [p("x")] }]);
    const nested = { ...p("parent"), children: [col("deep", [p("y")])] };
    expect(columnFixes([nested])).toEqual([{ kind: "unwrap", id: "deep", blocks: [p("y")] }]);
    expect(columnFixes([list("l", [col("c1", [col("inner", [p("z")])]), col("c2", [p("y")])])])).toEqual([
      { kind: "unwrap", id: "inner", blocks: [p("z")] },
    ]);
  });

  it("does not look inside a subtree it is already fixing", () => {
    const fixes = columnFixes([list("l", [col("c1", [col("inner", [p("z")])])])]);
    expect(fixes.map((f) => f.id)).toEqual(["l"]);
  });
});
