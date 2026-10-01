import type { EditorContent } from "@/features/editor/adapter/content";

/**
 * The save queue's state machine (U3), pure so every transition can be
 * tested without a browser. The hook (use-save-queue.ts) drives it with
 * time, the network and the server's answers; storage.ts keeps it on the
 * device so a reload or a lost connection never loses an edit.
 *
 * An edit becomes a `replace` operation. Operations wait SAVE_DELAY_MS
 * after the last edit (a batch), then go to the server as one request based
 * on the version last seen. The answer moves the queue to saved, or back to
 * pending with a reason: failed (retry with backoff), offline (retry when
 * online), conflict (the person chooses), forbidden or too large (kept, so
 * nothing is lost, until something changes).
 */

export const SAVE_DELAY_MS = 800;
export const RETRY_MS = 5000;
export const MAX_RETRY_MS = 60_000;
/** Next.js caps a server action's request at 1 MB; stay under it with room for the envelope. */
export const MAX_SAVE_CHARS = 950_000;

export type QueueStatus = "idle" | "saving" | "saved" | "offline" | "conflict" | "failed" | "forbidden" | "tooLarge";

export interface ReplaceOperation {
  id: string;
  kind: "replace";
  content: EditorContent;
  /** The editor's Yjs state, base64; null when the editor has none. */
  state: string | null;
  /** Device time of the edit, ms. */
  at: number;
}

export type QueueOperation = ReplaceOperation;

export interface QueueBatch {
  ops: QueueOperation[];
  baseVersion: number | null;
}

export interface QueueState {
  /** The document version the pending operations are based on; null before a first save. */
  version: number | null;
  /** Operations not yet sent, oldest first. */
  pending: QueueOperation[];
  /** The batch on the wire. */
  inFlight: QueueBatch | null;
  status: QueueStatus;
  /** Failed sends in a row; decides the backoff. */
  attempts: number;
  /** Earliest time the next send may start, after a failure. */
  notBefore: number | null;
  /** The server's version when a conflict was reported; 0 when it has no document. */
  conflictVersion: number | null;
  online: boolean;
}

export type SendOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; version: number | null }
  | { ok: false; reason: "forbidden" | "tooLarge" | "failed" | "offline" };

export function createQueue(version: number | null, online = true): QueueState {
  return {
    version,
    pending: [],
    inFlight: null,
    status: "idle",
    attempts: 0,
    notBefore: null,
    conflictVersion: null,
    online,
  };
}

/** Whether sends are stopped until the person (or their access) changes something. */
export function isBlocked(state: QueueState): boolean {
  return state.status === "conflict" || state.status === "forbidden";
}

export function hasUnsaved(state: QueueState): boolean {
  return state.pending.length > 0 || state.inFlight !== null;
}

/** The newest content the queue holds, sent or not; null when everything is saved. */
export function latestOperation(state: QueueState): QueueOperation | null {
  return state.pending.at(-1) ?? state.inFlight?.ops.at(-1) ?? null;
}

/**
 * Operations in order with every `replace` collapsed into the newest one:
 * a whole-document replace supersedes whatever came before it.
 */
function coalesce(ops: QueueOperation[]): QueueOperation[] {
  const newest = ops.at(-1);
  return newest ? [newest] : [];
}

/** A local edit. Feedback is immediate: the status is "saving" before anything is sent. */
export function enqueue(state: QueueState, op: QueueOperation): QueueState {
  const pending = coalesce([...state.pending, op]);
  // A conflict or a refusal waits for the person; the edit is kept meanwhile.
  const status: QueueStatus = isBlocked(state) ? state.status : state.online ? "saving" : "offline";
  return { ...state, pending, status, notBefore: null };
}

/** When the hook should next try to send, or null when there is nothing to send now. */
export function nextFlushAt(state: QueueState): number | null {
  if (state.inFlight || isBlocked(state) || !state.online || state.pending.length === 0) return null;
  // Too large waits for the next edit (enqueue clears it); retrying the same content cannot succeed.
  if (state.status === "tooLarge") return null;
  const last = state.pending[state.pending.length - 1];
  return Math.max(last.at + SAVE_DELAY_MS, state.notBefore ?? 0);
}

function sizeOf(op: QueueOperation): number {
  return JSON.stringify(op.content).length + (op.state?.length ?? 0);
}

/**
 * Takes the pending operations as the batch to send. `force` ignores the
 * batching delay (back online, tab shown again). Returns no batch when
 * nothing can go now; the state then says why.
 */
export function beginFlush(state: QueueState, now: number, force = false): { state: QueueState; batch: QueueBatch | null } {
  if (state.inFlight || isBlocked(state) || state.pending.length === 0) return { state, batch: null };
  if (!state.online) return { state: { ...state, status: "offline" }, batch: null };
  const due = nextFlushAt(state);
  if (!force && due !== null && due > now) return { state, batch: null };
  const newest = state.pending[state.pending.length - 1];
  if (sizeOf(newest) > MAX_SAVE_CHARS) {
    // Kept pending: a later, smaller version of the document can still save.
    return { state: { ...state, status: "tooLarge" }, batch: null };
  }
  const batch: QueueBatch = { ops: state.pending, baseVersion: state.version };
  return { state: { ...state, pending: [], inFlight: batch, status: "saving", notBefore: null }, batch };
}

function backoff(attempts: number): number {
  return Math.min(RETRY_MS * 2 ** Math.max(0, attempts - 1), MAX_RETRY_MS);
}

/** The server's answer to the batch in flight. Unsent operations go back in front of newer ones. */
export function completeFlush(state: QueueState, outcome: SendOutcome, now: number): QueueState {
  const sent = state.inFlight;
  if (!sent) return state;
  if (outcome.ok) {
    const version = outcome.version;
    return {
      ...state,
      version,
      inFlight: null,
      status: state.pending.length > 0 ? "saving" : "saved",
      attempts: 0,
      notBefore: null,
      conflictVersion: null,
    };
  }
  const pending = coalesce([...sent.ops, ...state.pending]);
  switch (outcome.reason) {
    case "conflict":
      return { ...state, pending, inFlight: null, status: "conflict", conflictVersion: outcome.version, attempts: 0, notBefore: null };
    case "forbidden":
      return { ...state, pending, inFlight: null, status: "forbidden", attempts: 0, notBefore: null };
    case "tooLarge":
      return { ...state, pending, inFlight: null, status: "tooLarge", attempts: 0, notBefore: null };
    case "offline":
      // The connection may already be back (its "online" event can arrive
      // while the request is still failing), so the flag is left to those
      // events and the send is simply tried again after a pause.
      return { ...state, pending, inFlight: null, status: "offline", attempts: 0, notBefore: now + RETRY_MS };
    case "failed": {
      const attempts = state.attempts + 1;
      return { ...state, pending, inFlight: null, status: "failed", attempts, notBefore: now + backoff(attempts) };
    }
  }
}

/** The network as the browser reports it. Back online, waiting edits may go at once. */
export function setOnline(state: QueueState, online: boolean): QueueState {
  if (online === state.online) return state;
  if (!online) {
    const status: QueueStatus = isBlocked(state) ? state.status : hasUnsaved(state) ? "offline" : state.status;
    return { ...state, online, status };
  }
  if (isBlocked(state)) return { ...state, online };
  const status: QueueStatus = state.pending.length > 0 || state.inFlight ? "saving" : state.status === "offline" ? "saved" : state.status;
  return { ...state, online, status, notBefore: null };
}

/**
 * After a conflict: "keep mine" re-sends the waiting edits on top of the
 * server's version; "take theirs" drops them for the server's content, which
 * the caller loads into the editor.
 */
export function resolveConflict(
  state: QueueState,
  choice: { kind: "keepMine" } | { kind: "takeTheirs"; version: number },
): QueueState {
  if (state.status !== "conflict") return state;
  if (choice.kind === "takeTheirs") {
    return { ...state, version: choice.version, pending: [], inFlight: null, status: "saved", conflictVersion: null, attempts: 0, notBefore: null };
  }
  // 0 means the server has no document any more: keeping mine creates it again.
  const version = state.conflictVersion === 0 ? null : (state.conflictVersion ?? state.version);
  return {
    ...state,
    version,
    status: state.pending.length > 0 ? (state.online ? "saving" : "offline") : "saved",
    conflictVersion: null,
    attempts: 0,
    notBefore: null,
  };
}

/** Puts operations found on the device (storage.ts) at the front, based on the version they were made on. */
export function restore(state: QueueState, version: number | null, ops: QueueOperation[]): QueueState {
  if (ops.length === 0) return state;
  const pending = coalesce([...ops, ...state.pending]);
  return { ...state, version, pending, status: state.online ? "saving" : "offline" };
}
