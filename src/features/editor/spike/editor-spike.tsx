"use client";

import dynamic from "next/dynamic";

/**
 * Loads the editor in the browser only: BlockNote and Yjs need the DOM, and
 * keeping them out of the server render also keeps them in their own chunk.
 */
const EditorSpikeInner = dynamic(() => import("./editor-spike-inner"), { ssr: false });

export function EditorSpike({ docId, raw, flushMs }: { docId: string | null; raw: boolean; flushMs?: number }) {
  return <EditorSpikeInner docId={docId} raw={raw} flushMs={flushMs} />;
}
