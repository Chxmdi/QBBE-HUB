import { describe, expect, it } from "vitest";
import type { EditorContent } from "@/features/editor/adapter/content";
import {
  beginFlush,
  completeFlush,
  createQueue,
  enqueue,
  hasUnsaved,
  latestOperation,
  MAX_RETRY_MS,
  MAX_SAVE_CHARS,
  nextFlushAt,
  resolveConflict,
  restore,
  RETRY_MS,
  SAVE_DELAY_MS,
  setOnline,
  type QueueOperation,
  type QueueState,
} from "@/features/editor/queue/queue";
import {
  clearPersistedQueue,
  persistQueue,
  queueKey,
  readPersistedQueue,
  type QueueStorage,
} from "@/features/editor/queue/storage";
import { contentToSnapshot, diffContents } from "@/features/editor/queue/compare";

const content = (text: string): EditorContent => ({
  version: 1,
  blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
});

let n = 0;
const op = (text: string, at: number, state: string | null = "AAAA"): QueueOperation => ({
  id: `op-${++n}`,
  kind: "replace",
  content: content(text),
  state,
  at,
});

/** Enqueue, wait out the batch delay and take the batch. */
function sent(state: QueueState, text: string, at: number) {
  const queued = enqueue(state, op(text, at));
  const begun = beginFlush(queued, at + SAVE_DELAY_MS);
  if (!begun.batch) throw new Error("expected a batch");
  return begun;
}

function memoryStorage(): QueueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("save queue: edits and batching", () => {
  it("starts idle with nothing to send", () => {
    const state = createQueue(3);
    expect(state.status).toBe("idle");
    expect(nextFlushAt(state)).toBeNull();
    expect(hasUnsaved(state)).toBe(false);
    expect(latestOperation(state)).toBeNull();
    expect(beginFlush(state, 1000).batch).toBeNull();
  });

  it("shows saving at once and waits the batch delay before sending", () => {
    const state = enqueue(createQueue(3), op("a", 1000));
    expect(state.status).toBe("saving");
    expect(hasUnsaved(state)).toBe(true);
    expect(nextFlushAt(state)).toBe(1000 + SAVE_DELAY_MS);
    expect(beginFlush(state, 1000 + SAVE_DELAY_MS - 1).batch).toBeNull();
    const begun = beginFlush(state, 1000 + SAVE_DELAY_MS);
    expect(begun.batch).toEqual({ ops: state.pending, baseVersion: 3 });
    expect(begun.state.pending).toEqual([]);
    expect(begun.state.inFlight).toBe(begun.batch);
  });

  it("collapses edits made within the delay into the newest one and restarts the delay", () => {
    let state = enqueue(createQueue(3), op("a", 1000));
    state = enqueue(state, op("ab", 1300));
    state = enqueue(state, op("abc", 1600));
    expect(state.pending).toHaveLength(1);
    expect(latestOperation(state)?.content).toEqual(content("abc"));
    expect(nextFlushAt(state)).toBe(1600 + SAVE_DELAY_MS);
  });

  it("sends at once when forced (back online, tab shown)", () => {
    const state = enqueue(createQueue(3), op("a", 1000));
    expect(beginFlush(state, 1001, true).batch).not.toBeNull();
  });

  it("sends one batch at a time; edits made meanwhile wait for the answer", () => {
    const begun = sent(createQueue(3), "a", 1000);
    const during = enqueue(begun.state, op("ab", 2000));
    expect(during.status).toBe("saving");
    expect(nextFlushAt(during)).toBeNull();
    expect(beginFlush(during, 5000, true).batch).toBeNull();
    const done = completeFlush(during, { ok: true, version: 4 }, 5000);
    expect(done.version).toBe(4);
    expect(done.status).toBe("saving");
    expect(nextFlushAt(done)).toBe(2000 + SAVE_DELAY_MS);
    expect(beginFlush(done, 5000).batch?.baseVersion).toBe(4);
  });

  it("is saved once the server confirms and nothing waits", () => {
    const begun = sent(createQueue(null), "a", 1000);
    expect(begun.batch?.baseVersion).toBeNull();
    const done = completeFlush(begun.state, { ok: true, version: 1 }, 2000);
    expect(done).toMatchObject({ version: 1, status: "saved", inFlight: null, pending: [], attempts: 0 });
    expect(hasUnsaved(done)).toBe(false);
  });

  it("ignores an answer when nothing is in flight", () => {
    const state = createQueue(2);
    expect(completeFlush(state, { ok: true, version: 9 }, 1)).toBe(state);
  });

  it("keeps a document too large to send, and sends a later smaller one", () => {
    const big = op("x".repeat(MAX_SAVE_CHARS + 1), 1000, null);
    const state = enqueue(createQueue(1), big);
    const begun = beginFlush(state, 1000 + SAVE_DELAY_MS);
    expect(begun.batch).toBeNull();
    expect(begun.state.status).toBe("tooLarge");
    expect(begun.state.pending).toEqual([big]);
    const smaller = enqueue(begun.state, op("small", 2000));
    expect(smaller.status).toBe("saving");
    expect(beginFlush(smaller, 2000 + SAVE_DELAY_MS).batch?.ops.map((o) => o.content)).toEqual([content("small")]);
  });

  it("keeps the edits and reports tooLarge when the server refuses the size", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const done = completeFlush(begun.state, { ok: false, reason: "tooLarge" }, 2000);
    expect(done.status).toBe("tooLarge");
    expect(done.pending.map((o) => o.content)).toEqual([content("a")]);
    expect(done.inFlight).toBeNull();
  });
});

describe("save queue: too large never loops", () => {
  it("does not schedule a retry of content refused as too large, locally or by the server", () => {
    const big = enqueue(createQueue(1), op("x".repeat(MAX_SAVE_CHARS + 1), 1000, null));
    const local = beginFlush(big, 1000 + SAVE_DELAY_MS).state;
    expect(local.status).toBe("tooLarge");
    expect(nextFlushAt(local)).toBeNull();

    const sentSmall = sent(createQueue(1), "a", 1000);
    const server = completeFlush(sentSmall.state, { ok: false, reason: "tooLarge" }, 2000);
    expect(nextFlushAt(server)).toBeNull();
    // The next edit tries again.
    expect(nextFlushAt(enqueue(server, op("b", 3000)))).toBe(3000 + SAVE_DELAY_MS);
  });
});

describe("save queue: failures and retries", () => {
  it("retries a failed send after a backoff that doubles up to a cap", () => {
    let state = sent(createQueue(1), "a", 1000).state;
    state = completeFlush(state, { ok: false, reason: "failed" }, 2000);
    expect(state.status).toBe("failed");
    expect(state.attempts).toBe(1);
    expect(state.notBefore).toBe(2000 + RETRY_MS);
    expect(state.pending.map((o) => o.content)).toEqual([content("a")]);
    expect(nextFlushAt(state)).toBe(2000 + RETRY_MS);
    expect(beginFlush(state, 2000 + RETRY_MS - 1).batch).toBeNull();

    let now = 2000 + RETRY_MS;
    for (const expected of [2 * RETRY_MS, 4 * RETRY_MS, 8 * RETRY_MS, 16 * RETRY_MS, MAX_RETRY_MS, MAX_RETRY_MS]) {
      const begun = beginFlush(state, now);
      expect(begun.batch).not.toBeNull();
      state = completeFlush(begun.state, { ok: false, reason: "failed" }, now);
      expect(state.notBefore).toBe(now + Math.min(expected, MAX_RETRY_MS));
      now = state.notBefore!;
    }
  });

  it("puts an unsent batch back in front of newer edits, newest content winning", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const during = enqueue(begun.state, op("ab", 1500));
    const failed = completeFlush(during, { ok: false, reason: "failed" }, 2000);
    expect(failed.pending.map((o) => o.content)).toEqual([content("ab")]);
  });

  it("a new edit after a failure shows saving and tries again after the delay", () => {
    let state = sent(createQueue(1), "a", 1000).state;
    state = completeFlush(state, { ok: false, reason: "failed" }, 2000);
    state = enqueue(state, op("ab", 3000));
    expect(state.status).toBe("saving");
    expect(state.notBefore).toBeNull();
    expect(nextFlushAt(state)).toBe(3000 + SAVE_DELAY_MS);
  });

  it("a success clears the failure count", () => {
    let state = sent(createQueue(1), "a", 1000).state;
    state = completeFlush(state, { ok: false, reason: "failed" }, 2000);
    state = completeFlush(beginFlush(state, 2000 + RETRY_MS).state, { ok: true, version: 2 }, 8000);
    expect(state).toMatchObject({ status: "saved", attempts: 0, notBefore: null, version: 2 });
  });

  it("stops on forbidden, keeping the edits", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const state = completeFlush(begun.state, { ok: false, reason: "forbidden" }, 2000);
    expect(state.status).toBe("forbidden");
    expect(state.pending).toHaveLength(1);
    expect(nextFlushAt(state)).toBeNull();
    const more = enqueue(state, op("ab", 3000));
    expect(more.status).toBe("forbidden");
    expect(nextFlushAt(more)).toBeNull();
    expect(beginFlush(more, 9000, true).batch).toBeNull();
  });
});

describe("save queue: offline", () => {
  it("reports offline for an edit made with no connection and sends when it returns", () => {
    let state = setOnline(createQueue(1), false);
    state = enqueue(state, op("a", 1000));
    expect(state.status).toBe("offline");
    expect(nextFlushAt(state)).toBeNull();
    const tried = beginFlush(state, 5000, true);
    expect(tried.batch).toBeNull();
    expect(tried.state.status).toBe("offline");
    state = setOnline(tried.state, true);
    expect(state.status).toBe("saving");
    expect(beginFlush(state, 5001, true).batch?.ops.map((o) => o.content)).toEqual([content("a")]);
  });

  it("goes offline when a send fails for lack of a connection, keeping the batch", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const state = completeFlush(begun.state, { ok: false, reason: "offline" }, 2000);
    // The browser's own events decide the flag; the send is tried again after a pause.
    expect(state).toMatchObject({ status: "offline", online: true, inFlight: null, attempts: 0, notBefore: 2000 + RETRY_MS });
    expect(nextFlushAt(state)).toBe(2000 + RETRY_MS);
    expect(state.pending.map((o) => o.content)).toEqual([content("a")]);
  });

  it("losing the connection with nothing waiting changes nothing but the flag", () => {
    const saved = completeFlush(sent(createQueue(1), "a", 1000).state, { ok: true, version: 2 }, 2000);
    const off = setOnline(saved, false);
    expect(off.status).toBe("saved");
    expect(off.online).toBe(false);
    const on = setOnline(off, true);
    expect(on.status).toBe("saved");
    expect(setOnline(on, true)).toBe(on);
  });

  it("losing the connection while a batch is on the wire shows offline until the answer", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const off = setOnline(begun.state, false);
    expect(off.status).toBe("offline");
    expect(completeFlush(off, { ok: true, version: 2 }, 3000).status).toBe("saved");
  });

  it("a conflict is not hidden by the connection coming and going", () => {
    const begun = sent(createQueue(1), "a", 1000);
    const conflict = completeFlush(begun.state, { ok: false, reason: "conflict", version: 5 }, 2000);
    expect(setOnline(conflict, false).status).toBe("conflict");
    expect(setOnline(setOnline(conflict, false), true).status).toBe("conflict");
  });
});

describe("save queue: conflicts", () => {
  const conflicted = () => {
    const begun = sent(createQueue(1), "mine", 1000);
    return completeFlush(begun.state, { ok: false, reason: "conflict", version: 5 }, 2000);
  };

  it("stops and remembers the server's version, keeping the edits", () => {
    const state = conflicted();
    expect(state).toMatchObject({ status: "conflict", conflictVersion: 5, version: 1, inFlight: null });
    expect(state.pending.map((o) => o.content)).toEqual([content("mine")]);
    expect(nextFlushAt(state)).toBeNull();
    expect(beginFlush(state, 9000, true).batch).toBeNull();
  });

  it("keeps accepting edits while the person decides", () => {
    const state = enqueue(conflicted(), op("mine more", 3000));
    expect(state.status).toBe("conflict");
    expect(latestOperation(state)?.content).toEqual(content("mine more"));
  });

  it("keep mine re-sends on top of the server's version", () => {
    const state = resolveConflict(conflicted(), { kind: "keepMine" });
    expect(state).toMatchObject({ status: "saving", version: 5, conflictVersion: null });
    const begun = beginFlush(state, 9000, true);
    expect(begun.batch).toEqual({ ops: state.pending, baseVersion: 5 });
    expect(completeFlush(begun.state, { ok: true, version: 6 }, 9500)).toMatchObject({ status: "saved", version: 6 });
  });

  it("keep mine while offline waits for the connection", () => {
    const state = resolveConflict(setOnline(conflicted(), false), { kind: "keepMine" });
    expect(state.status).toBe("offline");
    expect(state.version).toBe(5);
  });

  it("take theirs drops the edits and continues from the server's version", () => {
    const state = resolveConflict(conflicted(), { kind: "takeTheirs", version: 5 });
    expect(state).toMatchObject({ status: "saved", version: 5, pending: [], inFlight: null, conflictVersion: null });
    expect(hasUnsaved(state)).toBe(false);
    const next = enqueue(state, op("after", 10_000));
    expect(beginFlush(next, 10_000 + SAVE_DELAY_MS).batch?.baseVersion).toBe(5);
  });

  it("keep mine after the document disappeared creates it again", () => {
    const begun = sent(createQueue(4), "a", 1000);
    const gone = completeFlush(begun.state, { ok: false, reason: "conflict", version: 0 }, 2000);
    const state = resolveConflict(gone, { kind: "keepMine" });
    expect(state.version).toBeNull();
    expect(beginFlush(state, 9000, true).batch?.baseVersion).toBeNull();
  });

  it("resolving does nothing when there is no conflict", () => {
    const state = createQueue(1);
    expect(resolveConflict(state, { kind: "keepMine" })).toBe(state);
  });

  it("a conflict without a reported version re-sends on the version it had", () => {
    const begun = sent(createQueue(2), "a", 1000);
    const state = resolveConflict(completeFlush(begun.state, { ok: false, reason: "conflict", version: null }, 2000), {
      kind: "keepMine",
    });
    expect(state.version).toBe(2);
  });
});

describe("save queue: persistence", () => {
  it("writes the unconfirmed operations and removes them once saved", () => {
    const storage = memoryStorage();
    const queued = enqueue(createQueue(3), op("a", 1000));
    expect(persistQueue(storage, "obj", queued, "me", 1000)).toBe(true);
    const kept = readPersistedQueue(storage, "obj", "me");
    expect(kept).toMatchObject({ v: 1, objectId: "obj", version: 3, savedAt: 1000 });
    expect(kept?.ops.map((o) => o.content)).toEqual([content("a")]);

    const begun = beginFlush(queued, 2000);
    const during = enqueue(begun.state, op("ab", 2500));
    persistQueue(storage, "obj", during, "me");
    expect(readPersistedQueue(storage, "obj", "me")?.ops.map((o) => o.content)).toEqual([content("a"), content("ab")]);

    const saved = completeFlush(beginFlush(completeFlush(during, { ok: true, version: 4 }, 3000), 9000).state, { ok: true, version: 5 }, 9500);
    persistQueue(storage, "obj", saved, "me");
    expect(storage.map.has(queueKey("obj"))).toBe(false);
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
  });

  it("puts kept operations back in front, based on the version they were made on", () => {
    const storage = memoryStorage();
    persistQueue(storage, "obj", enqueue(createQueue(3), op("kept", 1000)), "me");
    const kept = readPersistedQueue(storage, "obj", "me")!;
    const state = restore(createQueue(7), kept.version, kept.ops);
    expect(state.status).toBe("saving");
    expect(state.version).toBe(3);
    expect(beginFlush(state, 99_000).batch).toEqual({ ops: kept.ops, baseVersion: 3 });
    expect(restore(createQueue(7), 3, [])).toEqual(createQueue(7));
  });

  it("survives a reload mid-send: the batch on the wire is kept too", () => {
    const storage = memoryStorage();
    const begun = sent(createQueue(3), "a", 1000);
    persistQueue(storage, "obj", begun.state, "me");
    expect(readPersistedQueue(storage, "obj", "me")?.ops.map((o) => o.content)).toEqual([content("a")]);
  });

  it("never puts back another person's draft", () => {
    const storage = memoryStorage();
    persistQueue(storage, "obj", enqueue(createQueue(3), op("private draft", 1000)), "alice");
    expect(readPersistedQueue(storage, "obj", "bob")).toBeNull();
    expect(readPersistedQueue(storage, "obj", "alice")?.ops.map((o) => o.content)).toEqual([content("private draft")]);
  });

  it("ignores damaged, foreign or empty entries", () => {
    const storage = memoryStorage();
    storage.setItem(queueKey("obj"), "{not json");
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
    storage.setItem(queueKey("obj"), JSON.stringify({ v: 1, objectId: "other", ownerId: "me", version: 1, ops: [op("a", 1)] }));
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
    storage.setItem(queueKey("obj"), JSON.stringify({ v: 2, objectId: "obj", ownerId: "me", version: 1, ops: [op("a", 1)] }));
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
    storage.setItem(queueKey("obj"), JSON.stringify({ v: 1, objectId: "obj", ownerId: "me", version: 1, ops: [{ kind: "replace" }] }));
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
    storage.setItem(queueKey("obj"), JSON.stringify({ v: 1, objectId: "obj", ownerId: "me", version: "x", ops: [op("a", 1)] }));
    expect(readPersistedQueue(storage, "obj", "me")?.version).toBeNull();
    clearPersistedQueue(storage, "obj");
    expect(readPersistedQueue(storage, "obj", "me")).toBeNull();
  });

  it("keeps working when storage refuses", () => {
    const refusing: QueueStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(persistQueue(refusing, "obj", enqueue(createQueue(1), op("a", 1)), "me")).toBe(false);
    expect(readPersistedQueue(refusing, "obj", "me")).toBeNull();
    expect(() => clearPersistedQueue(refusing, "obj")).not.toThrow();
  });
});

describe("save queue: review", () => {
  it("flattens a document into the block list the versions diff compares", () => {
    const doc: EditorContent = {
      version: 1,
      blocks: [
        { id: "h", type: "heading", content: [{ type: "text", text: "Agenda" }], children: [{ id: "c", type: "paragraph", content: [{ type: "text", text: "Child" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Loose" }] },
      ],
    };
    expect(contentToSnapshot(doc).blocks).toEqual([
      { id: "h", type: "heading", text: "Agenda", props: undefined },
      { id: "c", type: "paragraph", text: "Child", props: undefined },
      { id: "block-3", type: "paragraph", text: "Loose", props: undefined },
    ]);
  });

  it("shows theirs on the left and mine on the right, word by word", () => {
    const diff = diffContents(content("Doors open at 6"), content("Doors open at 7"));
    expect(diff.changedCount).toBe(1);
    const block = diff.blocks[0];
    expect(block.kind).toBe("changed");
    if (block.kind !== "changed") throw new Error("expected a change");
    expect(block.parts).toEqual([
      { kind: "same", text: "Doors open at " },
      { kind: "removed", text: "6" },
      { kind: "added", text: "7" },
    ]);
  });
});
