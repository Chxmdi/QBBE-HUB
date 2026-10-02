import type * as Y from "yjs";
import type { EditorContent } from "@/features/editor/adapter/content";
import { base64ToBytes } from "@/features/editor/adapter/state";
import type { QueueBatch, SendOutcome } from "@/features/editor/queue/queue";
import type { ServerEditorDocument } from "@/features/editor/services/editor-operations.commands";
import { mergeSavedState } from "./lineage";

/**
 * Saving while editing live (wave 2, C1).
 *
 * Every copy of a page saves through the operation queue, based on the
 * version it last saw. When two people edit live, each save makes the
 * other's next one stale, and the queue would report a conflict for changes
 * the person already has on screen. While a live session is open, a stale
 * save therefore first merges the server's saved state into the live copy
 * (Yjs merges are exact when both grew from the same saved state, which the
 * lineage guarantees) and sends the merged copy on top of the server's
 * version. Nothing is dropped: the merged copy holds everything the server
 * had and everything typed here. When the saved state is of another lineage
 * (a version restored, a copy converted elsewhere) nothing is merged and the
 * conflict reaches the person as before.
 */

export interface LiveCopy {
  doc: Y.Doc;
  lineage: string;
  /** The live copy now, as the queue would save it. */
  snapshot(): { content: EditorContent; state: string };
}

const copies = new Map<string, LiveCopy>();

export function registerLiveCopy(objectId: string, copy: LiveCopy): () => void {
  copies.set(objectId, copy);
  return () => {
    if (copies.get(objectId) === copy) copies.delete(objectId);
  };
}

export function liveCopy(objectId: string): LiveCopy | null {
  return copies.get(objectId) ?? null;
}

/** Stale saves merged and re-sent at most this many times in a row. */
export const MAX_MERGE_ATTEMPTS = 3;

export async function sendMergingLive(
  objectId: string,
  batch: QueueBatch,
  send: (batch: QueueBatch) => Promise<SendOutcome>,
  load: (objectId: string) => Promise<ServerEditorDocument | null>,
): Promise<SendOutcome> {
  let outcome = await send(batch);
  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    if (outcome.ok || outcome.reason !== "conflict") return outcome;
    const copy = liveCopy(objectId);
    if (!copy) return outcome;
    let saved: ServerEditorDocument | null;
    try {
      saved = await load(objectId);
    } catch {
      return outcome;
    }
    if (!saved || !saved.state) return outcome;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(saved.state);
    } catch {
      return outcome;
    }
    // The copy may have closed while the server answered.
    if (liveCopy(objectId) !== copy || !mergeSavedState(copy.doc, copy.lineage, bytes)) return outcome;
    const merged = copy.snapshot();
    const last = batch.ops[batch.ops.length - 1];
    outcome = await send({
      baseVersion: saved.version,
      ops: [{ ...last, content: merged.content, state: merged.state, at: Date.now() }],
    });
  }
  return outcome;
}
