"use client";

import * as React from "react";
import type { QueueBatch, SendOutcome } from "@/features/editor/queue/queue";
import { loadServerEditorDocument } from "@/features/editor/services/editor-operations.commands";
import { sendMergingLive } from "./live-save";

/**
 * The save queue's send, merging stale saves while a live session (wave 2,
 * C1) is open on the object; unchanged otherwise (live-save.ts).
 */
export function useLiveSend(
  objectId: string,
  send: (batch: QueueBatch) => Promise<SendOutcome>,
): (batch: QueueBatch) => Promise<SendOutcome> {
  return React.useCallback(
    (batch: QueueBatch) => sendMergingLive(objectId, batch, send, loadServerEditorDocument),
    [objectId, send],
  );
}
