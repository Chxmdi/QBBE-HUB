"use client";

import { useEffect } from "react";

/**
 * Brings a deep-linked row into view.
 *
 * Search can now land a reader on a specific risk, issue or document, but the
 * row it points at may be well down a list. Highlighting alone is not enough
 * when the highlight is below the fold — arriving at a page that looks
 * unchanged reads as a broken link.
 *
 * The scroll is deliberately the only thing this does: focus stays where the
 * browser put it, so a keyboard user is not thrown somewhere unannounced.
 */
export function DeepLinkScroll({ targetId }: { targetId: string | null }) {
  useEffect(() => {
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [targetId]);
  return null;
}
