/**
 * Wave 2 unit E5: the space kept for the editor while its code loads, so what
 * follows it on the page does not jump when it appears. A low estimate per
 * top-level block (a line of text is taller), and never more than the
 * screen: past that, what follows is out of sight anyway.
 */

/** Below the height of one line of text, so the estimate never overshoots. */
export const RESERVED_PX_PER_BLOCK = 24;

/** A CSS `min-height` for an editor about to show this many top-level blocks. */
export function editorReserve(blockCount: number): string | undefined {
  const blocks = Number.isFinite(blockCount) ? Math.max(0, Math.floor(blockCount)) : 0;
  if (blocks === 0) return undefined;
  return `min(${blocks * RESERVED_PX_PER_BLOCK}px, 100vh)`;
}
