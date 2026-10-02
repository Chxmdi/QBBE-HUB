import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { QueueBatch, SendOutcome } from "@/features/editor/queue/queue";
import type { ServerEditorDocument } from "@/features/editor/services/editor-operations.commands";
import type { BroadcastTransport } from "@/features/editor/spike/yjs-broadcast-provider";
import { hashBytes, lineageOf, mergeSavedState, readLineage, stampLineage } from "./lineage";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import { othersOnlyAwareness } from "./cursor-awareness";
import { lineageTransport } from "./lineage-transport";
import { liveCopy, MAX_MERGE_ATTEMPTS, registerLiveCopy, sendMergingLive } from "./live-save";

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return doc;
}

function loadCopy(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

describe("lineage", () => {
  it("is the same for every copy loaded from the same saved state", () => {
    const saved = Y.encodeStateAsUpdate(docWith("hello"));
    expect(lineageOf(loadCopy(saved))).toBe(lineageOf(loadCopy(saved)));
  });

  it("differs for copies converted separately, even with the same text", () => {
    expect(lineageOf(docWith("hello"))).not.toBe(lineageOf(docWith("hello")));
  });

  it("differs for two empty copies", () => {
    expect(lineageOf(new Y.Doc())).not.toBe(lineageOf(new Y.Doc()));
  });

  it("is kept once stamped, through a save and a load", () => {
    const doc = docWith("hello");
    const lineage = lineageOf(doc);
    stampLineage(doc, lineage);
    const loaded = loadCopy(Y.encodeStateAsUpdate(doc));
    expect(readLineage(loaded)).toBe(lineage);
    expect(lineageOf(loaded)).toBe(lineage);
    loaded.getText("t").insert(5, " world");
    expect(lineageOf(loadCopy(Y.encodeStateAsUpdate(loaded)))).toBe(lineage);
  });

  it("is never overwritten by a second stamp", () => {
    const doc = docWith("x");
    stampLineage(doc, "first-lineage");
    stampLineage(doc, "second-lineage");
    expect(readLineage(doc)).toBe("first-lineage");
  });

  it("hashes bytes to 16 hex digits, differently for different bytes", () => {
    expect(hashBytes(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{16}$/);
    expect(hashBytes(new Uint8Array([1, 2, 3]))).not.toBe(hashBytes(new Uint8Array([3, 2, 1])));
  });
});

describe("merging a saved state into a live copy", () => {
  function pair() {
    const origin = docWith("base");
    stampLineage(origin, "page-lineage");
    const saved = Y.encodeStateAsUpdate(origin);
    return { mine: loadCopy(saved), theirs: loadCopy(saved) };
  }

  it("merges a save of the same lineage, keeping both people's text", () => {
    const { mine, theirs } = pair();
    mine.getText("t").insert(4, " mine");
    theirs.getText("t").insert(0, "theirs ");
    expect(mergeSavedState(mine, "page-lineage", Y.encodeStateAsUpdate(theirs))).toBe(true);
    expect(mine.getText("t").toString()).toBe("theirs base mine");
  });

  it("refuses a save of another lineage and changes nothing", () => {
    const { mine } = pair();
    const foreign = docWith("other page body");
    stampLineage(foreign, "other-lineage");
    expect(mergeSavedState(mine, "page-lineage", Y.encodeStateAsUpdate(foreign))).toBe(false);
    expect(mine.getText("t").toString()).toBe("base");
  });

  it("refuses a save with no lineage (a restored version), a missing state and damaged bytes", () => {
    const { mine } = pair();
    expect(mergeSavedState(mine, "page-lineage", Y.encodeStateAsUpdate(docWith("restored")))).toBe(false);
    expect(mergeSavedState(mine, "page-lineage", null)).toBe(false);
    expect(mergeSavedState(mine, "page-lineage", new Uint8Array([255, 1, 2, 3]))).toBe(false);
    expect(mine.getText("t").toString()).toBe("base");
  });
});

describe("saving while editing live", () => {
  const batch: QueueBatch = {
    baseVersion: 4,
    ops: [{ id: "op", kind: "replace", content: { version: 1, blocks: [] }, state: "old", at: 1 }],
  };

  function liveSetup(objectId: string) {
    const origin = docWith("base");
    stampLineage(origin, "lineage-one");
    const saved = Y.encodeStateAsUpdate(origin);
    const mine = loadCopy(saved);
    const theirs = loadCopy(saved);
    mine.getText("t").insert(4, " mine");
    theirs.getText("t").insert(0, "theirs ");
    const unregister = registerLiveCopy(objectId, {
      doc: mine,
      lineage: "lineage-one",
      snapshot: () => ({
        content: { version: 1, blocks: [{ id: "p", type: "paragraph", content: [{ type: "text", text: mine.getText("t").toString() }] }] } as never,
        state: b64(Y.encodeStateAsUpdate(mine)),
      }),
    });
    const server: ServerEditorDocument = { content: { version: 1, blocks: [] }, state: b64(Y.encodeStateAsUpdate(theirs)), version: 7 };
    return { mine, server, unregister };
  }

  it("passes a conflict through when no live session is open", async () => {
    const send = vi.fn(async (): Promise<SendOutcome> => ({ ok: false, reason: "conflict", version: 5 }));
    const load = vi.fn();
    const outcome = await sendMergingLive("no-session", batch, send, load);
    expect(outcome).toEqual({ ok: false, reason: "conflict", version: 5 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("merges the saved state and sends the merged copy on top of the server's version", async () => {
    const { mine, server, unregister } = liveSetup("obj-merge");
    const sent: QueueBatch[] = [];
    const send = vi.fn(async (b: QueueBatch): Promise<SendOutcome> => {
      sent.push(b);
      return sent.length === 1 ? { ok: false, reason: "conflict", version: 7 } : { ok: true, version: 8 };
    });
    const outcome = await sendMergingLive("obj-merge", batch, send, async () => server);
    expect(outcome).toEqual({ ok: true, version: 8 });
    expect(mine.getText("t").toString()).toBe("theirs base mine");
    expect(sent[1].baseVersion).toBe(7);
    expect(JSON.stringify(sent[1].ops[0].content)).toContain("theirs base mine");
    expect(sent[1].ops[0].state).toBe(b64(Y.encodeStateAsUpdate(mine)));
    unregister();
    expect(liveCopy("obj-merge")).toBeNull();
  });

  it("leaves the conflict to the person when the saved state cannot be merged", async () => {
    const { mine, unregister } = liveSetup("obj-foreign");
    const send = vi.fn(async (): Promise<SendOutcome> => ({ ok: false, reason: "conflict", version: 9 }));
    const restored: ServerEditorDocument = { content: { version: 1, blocks: [] }, state: null, version: 9 };
    expect(await sendMergingLive("obj-foreign", batch, send, async () => restored)).toEqual({ ok: false, reason: "conflict", version: 9 });
    expect(await sendMergingLive("obj-foreign", batch, send, async () => null)).toEqual({ ok: false, reason: "conflict", version: 9 });
    expect(mine.getText("t").toString()).toBe("base mine");
    unregister();
  });

  it("gives up after a few stale saves in a row and reports the conflict", async () => {
    const { server, unregister } = liveSetup("obj-busy");
    const send = vi.fn(async (): Promise<SendOutcome> => ({ ok: false, reason: "conflict", version: 7 }));
    const outcome = await sendMergingLive("obj-busy", batch, send, async () => server);
    expect(outcome).toEqual({ ok: false, reason: "conflict", version: 7 });
    expect(send).toHaveBeenCalledTimes(1 + MAX_MERGE_ATTEMPTS);
    unregister();
  });

  it("never touches other outcomes", async () => {
    const { unregister } = liveSetup("obj-other");
    for (const result of [{ ok: true, version: 3 }, { ok: false, reason: "forbidden" }, { ok: false, reason: "offline" }] as SendOutcome[]) {
      const load = vi.fn();
      expect(await sendMergingLive("obj-other", batch, async () => result, load)).toEqual(result);
      expect(load).not.toHaveBeenCalled();
    }
    unregister();
  });
});

describe("the lineage transport", () => {
  function fakeTransport() {
    let handler: (event: string, payload: Record<string, unknown>) => void = () => {};
    const sent: { event: string; payload: Record<string, unknown> }[] = [];
    const inner: BroadcastTransport = {
      send: (event, payload) => sent.push({ event, payload }),
      onMessage: (h) => {
        handler = h;
      },
      onStatus: () => {},
      connect: () => {},
      disconnect: () => {},
    };
    return { inner, sent, deliver: (event: string, payload: Record<string, unknown>) => handler(event, payload) };
  }

  it("tags what it sends with the lineage and the sender", () => {
    const fake = fakeTransport();
    lineageTransport(fake.inner, "lin", "me", () => {}).send("y-update", { u: "x" });
    expect(fake.sent[0].payload).toEqual({ u: "x", c1: { l: "lin", u: "me" } });
  });

  it("passes on messages of its lineage and drops others, reporting who edits apart", () => {
    const fake = fakeTransport();
    const apart = vi.fn();
    const received = vi.fn();
    lineageTransport(fake.inner, "lin", "me", apart).onMessage(received);
    fake.deliver("y-update", { u: "1", c1: { l: "lin", u: "pm" } });
    fake.deliver("y-update", { u: "2", c1: { l: "other", u: "lead" } });
    fake.deliver("y-update", { u: "3" });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received.mock.calls[0][1]).toMatchObject({ u: "1" });
    expect(apart).toHaveBeenCalledWith("lead");
    expect(apart).toHaveBeenCalledTimes(1);
  });
});

describe("the cursor plugin's awareness", () => {
  it("passes on only changes that touch another copy, and is the awareness otherwise", () => {
    const mine = new Awareness(new Y.Doc());
    const theirs = new Awareness(new Y.Doc());
    const view = othersOnlyAwareness(mine);
    const heard = vi.fn();
    view.on("change", heard);

    // This copy's own cursor moving, or leaving the text: nothing to redraw.
    view.setLocalStateField("cursor", { anchor: 1, head: 1 });
    mine.setLocalStateField("cursor", null);
    expect(heard).not.toHaveBeenCalled();
    expect(view.getLocalState()).toMatchObject({ cursor: null });
    expect(view.clientID).toBe(mine.clientID);

    // Another person's cursor: redrawn.
    theirs.setLocalStateField("cursor", { anchor: 2, head: 2 });
    applyAwarenessUpdate(mine, encodeAwarenessUpdate(theirs, [theirs.clientID]), "peer");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0]).toMatchObject({ added: [theirs.clientID] });

    // Taken off again by the listener it was given.
    view.off("change", heard);
    theirs.setLocalStateField("cursor", { anchor: 3, head: 3 });
    applyAwarenessUpdate(mine, encodeAwarenessUpdate(theirs, [theirs.clientID]), "peer");
    expect(heard).toHaveBeenCalledTimes(1);
    mine.destroy();
    theirs.destroy();
  });
});
