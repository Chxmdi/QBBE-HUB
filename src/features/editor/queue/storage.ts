import type { EditorContent } from "@/features/editor/adapter/content";
import type { QueueOperation, QueueState } from "./queue";

/**
 * The queue on the device (U3): the operations not yet confirmed by the
 * server, under `editor-queue:<objectId>` in localStorage, written after
 * every change and removed once everything is saved. A reload, a closed tab
 * or a lost connection then never loses an edit: the next visit puts them
 * back in the queue, based on the version they were made on, so a save that
 * landed meanwhile is a conflict to resolve, not an overwrite.
 */

/** The part of Storage this uses, so tests (and a private window without storage) can supply their own. */
export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedQueue {
  v: 1;
  objectId: string;
  version: number | null;
  ops: QueueOperation[];
  savedAt: number;
}

export function queueKey(objectId: string): string {
  return `editor-queue:${objectId}`;
}

/** The unconfirmed operations: the batch on the wire first, then the waiting ones. */
export function unconfirmedOperations(state: QueueState): QueueOperation[] {
  return [...(state.inFlight?.ops ?? []), ...state.pending];
}

/** Writes the queue, or removes the entry when nothing is unconfirmed. Returns false when storage refused. */
export function persistQueue(storage: QueueStorage, objectId: string, state: QueueState, now = Date.now()): boolean {
  try {
    const ops = unconfirmedOperations(state);
    if (ops.length === 0) {
      storage.removeItem(queueKey(objectId));
      return true;
    }
    const record: PersistedQueue = { v: 1, objectId, version: state.version, ops, savedAt: now };
    storage.setItem(queueKey(objectId), JSON.stringify(record));
    return true;
  } catch {
    // Private windows and full storage refuse writes; the queue still works for this page.
    return false;
  }
}

export function clearPersistedQueue(storage: QueueStorage, objectId: string): void {
  try {
    storage.removeItem(queueKey(objectId));
  } catch {
    // Nothing to clear, or storage is unavailable.
  }
}

function isContent(value: unknown): value is EditorContent {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as { blocks?: unknown }).blocks);
}

function isOperation(value: unknown): value is QueueOperation {
  if (!value || typeof value !== "object") return false;
  const op = value as Partial<QueueOperation>;
  return (
    op.kind === "replace" &&
    typeof op.id === "string" &&
    typeof op.at === "number" &&
    isContent(op.content) &&
    (op.state === null || typeof op.state === "string")
  );
}

/** What the device holds for this object, or null when nothing (or nothing readable). */
export function readPersistedQueue(storage: QueueStorage, objectId: string): PersistedQueue | null {
  try {
    const raw = storage.getItem(queueKey(objectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedQueue>;
    if (parsed.v !== 1 || parsed.objectId !== objectId || !Array.isArray(parsed.ops)) return null;
    const ops = parsed.ops.filter(isOperation);
    if (ops.length === 0) return null;
    const version = typeof parsed.version === "number" && parsed.version > 0 ? parsed.version : null;
    return { v: 1, objectId, version, ops, savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0 };
  } catch {
    return null;
  }
}
