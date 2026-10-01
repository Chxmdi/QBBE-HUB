import { describe, expect, it } from "vitest";
import { parseStoredSpec, presetSpec, queryPresets, toQueryBlockRow } from "@/features/editor/semantic/queries";
import { fromContractSpec } from "@/lib/query/contract-adapter";
import { migrationCatalog } from "@/lib/query/testing/migration-catalog";
import { removedTaskIds, taskBlockIds } from "@/features/editor/semantic/removed";
import { blockTaskSource } from "@/features/editor/semantic/source";
import type { EditorContent } from "@/features/editor/adapter/content";

const doc = (...blocks: EditorContent["blocks"]): EditorContent => ({ version: 1, blocks });
const task = (objectId: string) => ({ type: "task", props: { objectId } });

const catalog = migrationCatalog();

describe("query block presets", () => {
  it("are specs the query engine's catalog accepts, for tasks, decisions and meetings", () => {
    const types = new Set<string>();
    for (const preset of queryPresets) {
      const spec = presetSpec(preset);
      expect(spec.version).toBe(1);
      expect(() => fromContractSpec(spec, catalog), preset).not.toThrow();
      types.add(spec.types[0]);
      if (spec.types[0] === "task") expect(JSON.stringify(spec.filter)).toContain('"status","op":"neq","value":"completed"');
    }
    expect([...types].sort()).toEqual(["decision", "meeting", "task"]);
    expect(JSON.stringify(presetSpec("my_open").filter)).toContain('{"relative":"me"}');
    expect(fromContractSpec(presetSpec("upcoming_meetings"), catalog).where).toEqual({
      and: [
        { property: "starts", operator: "on_or_after", value: { relative: "today" } },
        { property: "status", operator: "is_not", value: "cancelled" },
      ],
    });
  });

  it("round-trip through block props and refuse malformed specs", () => {
    expect(parseStoredSpec(JSON.stringify(presetSpec("overdue")))?.filter).toEqual(presetSpec("overdue").filter);
    expect(parseStoredSpec("{nope")).toBeNull();
    expect(parseStoredSpec({ version: 2, types: ["task"] })).toBeNull();
    expect(parseStoredSpec({ version: 1, types: [] })).toBeNull();
    expect(parseStoredSpec({ version: 1, types: ["task"], limit: 5000 })?.limit).toBe(50);
  });

  it("shows each type with its own link, status label and date", () => {
    const project = { kind: "relation" as const, value: [{ id: "p1", type: "project" }] };
    const task = toQueryBlockRow({ ref: { id: "t1", type: "task" }, title: "T", values: { status: { kind: "status", value: "in_progress" }, due: { kind: "date", value: "2026-10-09" } } }, catalog, "en");
    expect(task).toEqual({ id: "t1", type: "task", title: "T", href: "/my-work?task=t1", status: "in_progress", statusLabel: null, date: "2026-10-09", dateLabel: "due" });
    const decision = toQueryBlockRow({ ref: { id: "d1", type: "decision" }, title: "D", values: { decided_time: { kind: "date", value: "2026-10-01T15:00:00Z" }, meeting: null, project } }, catalog, "fr-CA");
    expect(decision).toMatchObject({ href: "/projects/p1", status: null, statusLabel: null, date: "2026-10-01T15:00:00Z", dateLabel: "decided" });
    const meeting = toQueryBlockRow({ ref: { id: "m1", type: "meeting" }, title: "M", values: { status: { kind: "status", value: "scheduled" }, starts: { kind: "date", value: "2026-10-12T14:00:00Z" } } }, catalog, "fr-CA");
    expect(meeting).toMatchObject({ href: "/meetings/m1", status: null, statusLabel: "Planifiée", dateLabel: "starts" });
    const bare = toQueryBlockRow({ ref: { id: "r1", type: "risk" }, title: "R", values: {} }, catalog, "en");
    expect(bare).toMatchObject({ href: "/projects", statusLabel: null, date: null, dateLabel: null });
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

describe("the source a block-made task records (M7b)", () => {
  it("names the page or the meeting the block sits in, and nothing for a task description", () => {
    expect(blockTaskSource("page", "p1")).toEqual({ type: "page", id: "p1" });
    expect(blockTaskSource("meeting", "m1")).toEqual({ type: "meeting", id: "m1" });
    expect(blockTaskSource("task", "t1")).toBeUndefined();
  });
});
