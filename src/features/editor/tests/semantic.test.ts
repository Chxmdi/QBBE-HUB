import { describe, expect, it } from "vitest";
import { parseStoredSpec, presetSpec, presetViewBlock, queryPresets } from "@/features/editor/semantic/queries";
import { parseViewBlockProps, readStoredViewBlock } from "@/features/lenses/view-block/schema";
import { removedTaskIds, taskBlockIds } from "@/features/editor/semantic/removed";
import type { EditorContent } from "@/features/editor/adapter/content";

const doc = (...blocks: EditorContent["blocks"]): EditorContent => ({ version: 1, blocks });
const task = (objectId: string) => ({ type: "task", props: { objectId } });

describe("query block presets", () => {
  it("are task queries the stand-in accepts", () => {
    for (const preset of queryPresets) {
      const spec = presetSpec(preset);
      expect(spec.version).toBe(1);
      expect(spec.types).toEqual(["task"]);
      expect(JSON.stringify(spec.filter)).toContain('"status","op":"neq","value":"completed"');
    }
    expect(JSON.stringify(presetSpec("my_open").filter)).toContain('{"relative":"me"}');
  });

  it("round-trip through block props and refuse malformed specs", () => {
    expect(parseStoredSpec(JSON.stringify(presetSpec("overdue")))?.filter).toEqual(presetSpec("overdue").filter);
    expect(parseStoredSpec("{nope")).toBeNull();
    expect(parseStoredSpec({ version: 2, types: ["task"] })).toBeNull();
    expect(parseStoredSpec({ version: 1, types: [] })).toBeNull();
    expect(parseStoredSpec({ version: 1, types: ["task"], limit: 5000 })?.limit).toBe(50);
  });
});

describe("preset upgrade to a view block", () => {
  it("maps every preset to a valid version 2 block that the legacy parser refuses", () => {
    for (const preset of queryPresets) {
      const view = presetViewBlock(preset);
      const parsed = parseViewBlockProps(view);
      expect(parsed, preset).not.toBeNull();
      expect(parsed?.source).toEqual({ type: "task" });
      expect(parsed?.where.map((c) => c.path)).toContain("status");
      expect(readStoredViewBlock(JSON.stringify(view))).toEqual({ kind: "view", raw: view });
      expect(parseStoredSpec(JSON.stringify(view))).toBeNull();
    }
    expect(presetViewBlock("my_open").where?.[0]).toEqual({ path: "assignee", op: "contains", value: { relative: "me" } });
    expect(presetViewBlock("overdue").where?.[0]).toEqual({ path: "due", op: "before", value: { relative: "today" } });
    expect(presetViewBlock("due_this_week").where?.[0]).toEqual({ path: "due", op: "is", value: { relative: "this_week" } });
    // A stored preset spec is never mistaken for a view block.
    expect(readStoredViewBlock(JSON.stringify(presetSpec("overdue")))).toEqual({ kind: "legacy" });
  });
});

describe("removed task blocks", () => {
  it("finds task blocks at any depth", () => {
    const content = doc(task("a"), { type: "paragraph", children: [task("b")] }, { type: "task", props: { objectId: "" } });
    expect([...taskBlockIds(content)].sort()).toEqual(["a", "b"]);
  });

  it("reports only tasks whose block is gone, not moved ones", () => {
    const before = doc(task("a"), task("b"), task("c"));
    const after = doc(task("c"), { type: "paragraph", children: [task("a")] });
    expect(removedTaskIds(before, after)).toEqual(["b"]);
    expect(removedTaskIds(after, after)).toEqual([]);
  });
});
