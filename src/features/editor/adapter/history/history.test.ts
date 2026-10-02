import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  EditorHistory,
  classifyChanges,
  isRemoteChange,
  savedElsewhere,
  type BlockChange,
  type ChangeKind,
} from "./history";

/**
 * The history against a real Yjs document and undo manager, set up the way
 * the editor's is: changes written by the editor carry one origin, and the
 * manager groups changes made within its capture time (here a long one, so
 * only the history's step boundaries can separate them).
 */

const EDITOR = { name: "editor-sync" };

interface Block {
  id: string;
  type: string;
  color: string;
  text: string;
}

function setup() {
  const doc = new Y.Doc();
  const blocks = doc.getArray<Y.Map<unknown>>("blocks");
  const manager = new Y.UndoManager(blocks, { trackedOrigins: new Set([EDITOR]), captureTimeout: 60_000 });
  const history = new EditorHistory(() => manager);
  history.markOpened();

  const read = (): Block[] =>
    blocks.toArray().map((map) => ({
      id: map.get("id") as string,
      type: map.get("type") as string,
      color: map.get("color") as string,
      text: (map.get("text") as Y.Text).toString(),
    }));
  const indexOf = (id: string) => read().findIndex((block) => block.id === id);
  const make = (block: Block) => {
    const map = new Y.Map<unknown>();
    map.set("id", block.id);
    map.set("type", block.type);
    map.set("color", block.color);
    map.set("text", new Y.Text(block.text));
    return map;
  };

  /** One editor change: the history hears about it first, then it is written. */
  const change = (kind: ChangeKind, write: () => void) => {
    history.beforeChange(kind);
    doc.transact(write, EDITOR);
    history.afterChange();
  };
  const structure: ChangeKind = { kind: "structure" };

  const ops = {
    type: (id: string, text: string) =>
      change({ kind: "text", blockId: id }, () => {
        const target = blocks.get(indexOf(id)).get("text") as Y.Text;
        target.insert(target.length, text);
      }),
    insert: (block: Block, at: number) => change(structure, () => blocks.insert(at, [make(block)])),
    move: (id: string, to: number) =>
      change(structure, () => {
        const block = read()[indexOf(id)];
        blocks.delete(indexOf(id), 1);
        blocks.insert(to, [make(block)]);
      }),
    turnInto: (id: string, type: string) => change(structure, () => blocks.get(indexOf(id)).set("type", type)),
    color: (id: string, color: string) => change(structure, () => blocks.get(indexOf(id)).set("color", color)),
    duplicate: (id: string) => change(structure, () => blocks.insert(indexOf(id) + 1, [make({ ...read()[indexOf(id)], id: `${id}-copy` })])),
    remove: (id: string) => change(structure, () => blocks.delete(indexOf(id), 1)),
  };
  return { doc, blocks, manager, history, read, ops, make };
}

const summary = (blocks: Block[]) => blocks.map((b) => `${b.type}:${b.color}:${b.text}`).join(" | ");

describe("where one undo step ends (E2-1)", () => {
  it("undoes typing, block creation, move, turn into, colour, duplicate and delete one step each", () => {
    const { history, read, ops } = setup();
    const states: string[] = [summary(read())];
    const step = (action: () => void) => {
      action();
      states.push(summary(read()));
    };

    step(() => ops.insert({ id: "a", type: "paragraph", color: "default", text: "" }, 0));
    // Two quick bursts of typing in one block are one step.
    step(() => {
      ops.type("a", "Hel");
      ops.type("a", "lo");
    });
    step(() => ops.insert({ id: "b", type: "paragraph", color: "default", text: "" }, 1));
    step(() => ops.type("b", "World"));
    step(() => ops.move("b", 0));
    step(() => ops.turnInto("b", "heading"));
    step(() => ops.color("b", "red"));
    step(() => ops.duplicate("a"));
    step(() => ops.remove("b"));

    expect(states.at(-1)).toBe("paragraph:default:Hello | paragraph:default:Hello");

    // Every undo goes back exactly one action.
    for (let i = states.length - 2; i >= 0; i -= 1) {
      expect(history.undo()).toBe("done");
      expect(summary(read())).toBe(states[i]);
    }
    expect(history.undo()).toBe("empty");
    expect(history.canUndo()).toBe(false);

    // And every redo forward one.
    for (let i = 1; i < states.length; i += 1) {
      expect(history.redo()).toBe("done");
      expect(summary(read())).toBe(states[i]);
    }
    expect(history.redo()).toBe("empty");
  });

  it("keeps typing in two different blocks as two steps", () => {
    const { history, read, ops } = setup();
    ops.insert({ id: "a", type: "paragraph", color: "default", text: "" }, 0);
    ops.insert({ id: "b", type: "paragraph", color: "default", text: "" }, 1);
    ops.type("a", "first");
    ops.type("b", "second");
    history.undo();
    expect(read().map((b) => b.text)).toEqual(["first", ""]);
  });

  it("needs those boundaries: without them the manager merges everything into one step", () => {
    const { doc, blocks, manager, make, read } = setup();
    doc.transact(() => blocks.insert(0, [make({ id: "a", type: "paragraph", color: "default", text: "Hello" })]), EDITOR);
    doc.transact(() => blocks.get(0).set("type", "heading"), EDITOR);
    manager.undo();
    expect(read()).toEqual([]);
  });

  it("an undo starts a new step: typing after it is not merged into the redo", () => {
    const { history, read, ops } = setup();
    ops.insert({ id: "a", type: "paragraph", color: "default", text: "" }, 0);
    ops.type("a", "one");
    history.undo();
    ops.type("a", "two");
    history.undo();
    expect(read().map((b) => b.text)).toEqual([""]);
    expect(history.redo()).toBe("done");
    expect(read().map((b) => b.text)).toEqual(["two"]);
  });
});

describe("classifying the editor's block changes", () => {
  const block = (over: Partial<{ id: string; type: string; props: unknown; content: unknown }> = {}) => ({
    id: "a",
    type: "paragraph",
    props: { textColor: "default" },
    content: [{ type: "text", text: "Hi" }],
    ...over,
  });
  const local = { type: "local" };

  it("calls text typed in one block typing", () => {
    const changes: BlockChange[] = [
      { type: "update", source: local, prevBlock: block(), block: block({ content: [{ type: "text", text: "Hi!" }] }) },
    ];
    expect(classifyChanges(changes)).toEqual({ kind: "text", blockId: "a" });
  });

  it("ignores a parent reported only because its child changed", () => {
    const changes: BlockChange[] = [
      { type: "update", source: local, prevBlock: block({ id: "parent", content: undefined }), block: block({ id: "parent", content: undefined }) },
      { type: "update", source: local, prevBlock: block(), block: block({ content: [{ type: "text", text: "Hi!" }] }) },
    ];
    expect(classifyChanges(changes)).toEqual({ kind: "text", blockId: "a" });
  });

  it("calls a new, removed or moved block, turn into, a colour, a paste and typing in two blocks a structure change", () => {
    const typed = block({ content: [{ type: "text", text: "Hi!" }] });
    const cases: BlockChange[][] = [
      [{ type: "insert", source: local, block: block() }],
      [{ type: "delete", source: local, block: block() }],
      [{ type: "move", source: local, prevBlock: block(), block: block() }],
      [{ type: "update", source: local, prevBlock: block(), block: block({ type: "heading" }) }],
      [{ type: "update", source: local, prevBlock: block(), block: block({ props: { textColor: "red" } }) }],
      [{ type: "update", source: { type: "paste" }, prevBlock: block(), block: typed }],
      [
        { type: "update", source: local, prevBlock: block(), block: typed },
        { type: "update", source: local, prevBlock: block({ id: "b" }), block: { ...typed, id: "b" } },
      ],
    ];
    for (const changes of cases) expect(classifyChanges(changes)).toEqual({ kind: "structure" });
  });

  it("leaves undo, redo and changes from elsewhere out of it", () => {
    for (const source of ["undo", "redo", "undo-redo", "yjs-remote"]) {
      expect(classifyChanges([{ type: "insert", source: { type: source }, block: block() }])).toEqual({ kind: "none" });
    }
    expect(classifyChanges([])).toEqual({ kind: "none" });
  });
});

describe("where the history starts (E2-2, E2-5)", () => {
  it("does not count what the editor does while the page opens", () => {
    const doc = new Y.Doc();
    const blocks = doc.getArray<string>("blocks");
    const manager = new Y.UndoManager(blocks, { trackedOrigins: new Set([EDITOR]) });
    const history = new EditorHistory(() => manager);
    doc.transact(() => blocks.insert(0, ["trailing paragraph the editor adds"]), EDITOR);
    history.afterChange();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe("empty");
    expect(blocks.toArray()).toEqual(["trailing paragraph the editor adds"]);

    history.markOpened();
    doc.transact(() => blocks.insert(1, ["typed by the person"]), EDITOR);
    history.afterChange();
    expect(history.undo()).toBe("done");
    expect(blocks.toArray()).toEqual(["trailing paragraph the editor adds"]);
  });

  it("starts again after a change from someone else, so their change is never undone", () => {
    const { doc, history, read, ops, make } = setup();
    ops.insert({ id: "a", type: "paragraph", color: "default", text: "" }, 0);
    ops.type("a", "mine");

    // Another person's copy of the page sends an update.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getArray<Y.Map<unknown>>("blocks").insert(1, [make({ id: "t", type: "paragraph", color: "default", text: "theirs" })]);
    let remote = false;
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      if (isRemoteChange(transaction)) remote = history.restart();
    });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));

    expect(remote).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBe("empty");
    expect(read().map((b) => b.text)).toEqual(["mine", "theirs"]);

    // New steps after it undo normally, and only back to that point.
    ops.type("a", " again");
    expect(history.undo()).toBe("done");
    expect(read().map((b) => b.text)).toEqual(["mine", "theirs"]);
    expect(history.undo()).toBe("empty");
  });

  it("tells a change typed here from one that arrived", () => {
    expect(isRemoteChange({ local: true, changed: { size: 1 } })).toBe(false);
    expect(isRemoteChange({ local: false, changed: { size: 0 } })).toBe(false);
    expect(isRemoteChange({ local: false, changed: { size: 1 } })).toBe(true);
  });

  it("restarts once when the save queue reports a save from elsewhere", () => {
    expect(savedElsewhere("saving", "conflict")).toBe(true);
    expect(savedElsewhere(null, "conflict")).toBe(true);
    expect(savedElsewhere("conflict", "conflict")).toBe(false);
    expect(savedElsewhere("conflict", "saved")).toBe(false);
    expect(savedElsewhere("saving", "saved")).toBe(false);
  });

  it("reports whether a restart forgot anything", () => {
    const { history, ops } = setup();
    expect(history.restart()).toBe(false);
    ops.insert({ id: "a", type: "paragraph", color: "default", text: "" }, 0);
    expect(history.restart()).toBe(true);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
