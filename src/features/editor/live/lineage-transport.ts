import type { BroadcastTransport } from "@/features/editor/spike/yjs-broadcast-provider";

/**
 * Wraps a page's live channel so copies of different lineages (lineage.ts)
 * never apply each other's changes. Each message is tagged with the sender's
 * lineage and user; a message of another lineage is dropped, and its sender
 * reported, so the editor can say who is editing apart.
 */
export function lineageTransport(
  inner: BroadcastTransport,
  lineage: string,
  userId: string,
  onApart: (userId: string) => void,
): BroadcastTransport {
  return {
    send(event, payload) {
      inner.send(event, { ...payload, c1: { l: lineage, u: userId } });
    },
    onMessage(handler) {
      inner.onMessage((event, payload) => {
        const tag = payload.c1 as { l?: unknown; u?: unknown } | undefined;
        if (!tag || tag.l !== lineage) {
          if (tag && typeof tag.u === "string") onApart(tag.u);
          return;
        }
        handler(event, payload);
      });
    },
    onStatus: (handler) => inner.onStatus(handler),
    connect: () => inner.connect(),
    disconnect: () => inner.disconnect(),
  };
}
