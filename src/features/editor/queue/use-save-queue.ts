"use client";

import * as React from "react";
import type { EditorContent } from "@/features/editor/adapter/content";
import {
  beginFlush,
  completeFlush,
  createQueue,
  enqueue,
  hasUnsaved,
  latestOperation,
  nextFlushAt,
  resolveConflict,
  restore,
  setOnline,
  type QueueBatch,
  type QueueOperation,
  type QueueState,
  type QueueStatus,
  type SendOutcome,
} from "./queue";
import { clearPersistedQueue, persistQueue, readPersistedQueue, type QueueStorage } from "./storage";

export interface SaveQueueOptions {
  objectId: string;
  initialVersion: number | null;
  /** What the server rendered; an unsaved edit on the device wins over it. */
  initialContent: EditorContent;
  initialState?: string | null;
  /** Sends one batch; never throws. */
  send: (batch: QueueBatch) => Promise<SendOutcome>;
  /** Off while the editor is read-only: nothing is queued or sent. */
  enabled: boolean;
  /** Defaults to window.localStorage; null keeps nothing on the device. */
  storage?: QueueStorage | null;
  /**
   * The signed-in person, once known (undefined while it is being read). The
   * device copy is written and put back only for them, so on a shared
   * browser one person's unsaved draft never reaches the next person.
   */
  ownerId?: string | null;
}

/** What the editor should be mounted with; a new key means mount it again. */
export interface EditorSeed {
  content: EditorContent;
  state: string | null;
  key: number;
  /** Why: the server's render, an unsaved edit kept on this device, or the other person's version after a conflict. */
  reason: "initial" | "restored" | "theirs";
}

export interface SaveConflict {
  /** Counts conflicts, so the caller can tell a new one from one already dismissed. */
  id: number;
  /** The server's version, when reported. */
  version: number | null;
}

export interface SaveQueue {
  status: QueueStatus;
  conflict: SaveConflict | null;
  seed: EditorSeed;
  enqueue: (content: EditorContent, state: string | null) => void;
  /** After a conflict: send the waiting edits on top of the server's version. */
  keepMine: () => void;
  /** After a conflict: drop the waiting edits and mount the editor on the server's content. */
  takeTheirs: (theirs: { content: EditorContent; state: string | null; version: number }) => void;
  /** Try again now, ignoring the batching delay and any backoff. */
  flushNow: () => void;
  /** The newest content on this device, sent or not. */
  latest: () => QueueOperation | null;
  hasUnsaved: () => boolean;
}

function defaultStorage(): QueueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * Autosave through the operation queue: immediate feedback, one batch at a
 * time, retries with backoff, a flush when the connection or the tab comes
 * back, and the queue kept on the device between visits.
 */
export function useSaveQueue(options: SaveQueueOptions): SaveQueue {
  const { objectId, initialVersion, initialContent, initialState = null, send, enabled, ownerId } = options;
  const storage = React.useMemo(
    () => (options.storage === undefined ? defaultStorage() : options.storage),
    [options.storage],
  );
  const state = React.useRef<QueueState>(createQueue(initialVersion));
  const [view, setView] = React.useState<{ status: QueueStatus; conflict: SaveConflict | null; seed: EditorSeed }>(() => ({
    status: "idle",
    conflict: null,
    seed: { content: initialContent, state: initialState, key: 0, reason: "initial" },
  }));
  const conflicts = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = React.useRef(send);
  React.useEffect(() => {
    sendRef.current = send;
  }, [send]);
  // Lets the scheduled flush call the latest closure without naming itself.
  const flushRef = React.useRef<(force: boolean) => void>(() => {});
  // False once the editor has gone: no more timers or sends from this queue.
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const persist = React.useCallback(() => {
    if (storage && typeof ownerId === "string") persistQueue(storage, objectId, state.current, ownerId);
  }, [storage, objectId, ownerId]);

  const commit = React.useCallback(
    (
      next: QueueState,
      seed?: { content: EditorContent; state: string | null; reason: EditorSeed["reason"] },
      keep = true,
    ) => {
      const newConflict = next.status === "conflict" && state.current.status !== "conflict";
      if (newConflict) conflicts.current += 1;
      const conflictId = conflicts.current;
      state.current = next;
      // Every key press would serialize the whole document; an edit that
      // will be sent within the batch delay is written when the batch forms
      // (or when the page is hidden) instead.
      if (keep) persist();
      setView((current) => {
        const conflict: SaveConflict | null =
          next.status !== "conflict" ? null : newConflict || !current.conflict ? { id: conflictId, version: next.conflictVersion } : current.conflict;
        const unchanged = current.status === next.status && current.conflict === conflict && !seed;
        if (unchanged) return current;
        return {
          status: next.status,
          conflict,
          seed: seed ? { ...seed, key: current.seed.key + 1 } : current.seed,
        };
      });
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const at = nextFlushAt(next);
      if (at !== null && alive.current) {
        timer.current = setTimeout(() => flushRef.current(false), Math.max(0, at - Date.now()));
      }
    },
    [persist],
  );

  const flush = React.useCallback(
    (force: boolean) => {
      if (!enabled || !alive.current) return;
      const begun = beginFlush(state.current, Date.now(), force);
      commit(begun.state);
      const batch = begun.batch;
      if (!batch) return;
      void sendRef
        .current(batch)
        .catch((): SendOutcome => ({ ok: false, reason: "failed" }))
        .then((outcome) => {
          // Only the batch this flush sent may complete; a stale answer (after "take theirs") is ignored.
          if (state.current.inFlight !== batch) return;
          commit(completeFlush(state.current, outcome, Date.now()));
        });
    },
    [commit, enabled],
  );
  React.useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // What the device kept from an earlier visit.
  React.useEffect(() => {
    if (!enabled || !storage || typeof ownerId !== "string") return;
    const kept = readPersistedQueue(storage, objectId, ownerId);
    if (!kept) return;
    const newest = kept.ops[kept.ops.length - 1];
    // The edit landed before the page closed: the server already shows it.
    if (JSON.stringify(newest.content) === JSON.stringify(initialContent)) {
      clearPersistedQueue(storage, objectId);
      return;
    }
    commit(restore(state.current, kept.version, kept.ops), { content: newest.content, state: newest.state, reason: "restored" });
    // Once only, when the editor opens and the person is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, enabled, storage, ownerId]);

  React.useEffect(() => {
    if (!enabled) return;
    const online = () => {
      commit(setOnline(state.current, true));
      flushRef.current(true);
    };
    const offline = () => commit(setOnline(state.current, false));
    const visible = () => {
      if (document.visibilityState === "visible") flushRef.current(true);
      else persist();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      if (hasUnsaved(state.current)) event.preventDefault();
    };
    const pageHide = () => persist();
    if (typeof navigator !== "undefined" && navigator.onLine === false) commit(setOnline(state.current, false));
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pageHide);
    return () => {
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [commit, enabled, persist]);

  const add = React.useCallback(
    (content: EditorContent, yjs: string | null) => {
      if (!enabled) return;
      const next = enqueue(state.current, { id: newId(), kind: "replace", content, state: yjs, at: Date.now() });
      // On its way within the batch delay: written when the batch forms. Otherwise (offline, failed, conflict) now.
      commit(next, undefined, !(next.status === "saving" && next.online));
    },
    [commit, enabled],
  );

  const keepMine = React.useCallback(() => {
    commit(resolveConflict(state.current, { kind: "keepMine" }));
    flushRef.current(true);
  }, [commit]);

  const takeTheirs = React.useCallback(
    (theirs: { content: EditorContent; state: string | null; version: number }) => {
      commit(resolveConflict(state.current, { kind: "takeTheirs", version: theirs.version }), {
        content: theirs.content,
        state: theirs.state,
        reason: "theirs",
      });
    },
    [commit],
  );

  const flushNow = React.useCallback(() => flushRef.current(true), []);
  const latest = React.useCallback(() => latestOperation(state.current), []);
  const unsaved = React.useCallback(() => hasUnsaved(state.current), []);

  return React.useMemo(
    () => ({
      status: view.status,
      conflict: view.conflict,
      seed: view.seed,
      enqueue: add,
      keepMine,
      takeTheirs,
      flushNow,
      latest,
      hasUnsaved: unsaved,
    }),
    [view, add, keepMine, takeTheirs, flushNow, latest, unsaved],
  );
}
