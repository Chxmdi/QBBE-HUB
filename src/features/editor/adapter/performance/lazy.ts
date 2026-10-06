/**
 * Wave 2 unit E5: which blocks wait until they are near the screen, how much
 * space they keep while they wait, and the text that stays findable. Pure, so
 * the block frame and the tests read the same rules.
 */

/** Blocks that load data or a frame: view blocks (`query`) and embeds. */
export const LAZY_BLOCK_TYPES = ["query", "embed"] as const;
export type LazyBlockType = (typeof LAZY_BLOCK_TYPES)[number];

/** How far outside the screen a waiting block starts to render, in pixels. */
export const LAZY_ROOT_MARGIN_PX = 800;

/** The space a waiting block keeps before its real height is known. */
export const ESTIMATED_HEIGHT_PX: Record<LazyBlockType, number> = { query: 240, embed: 360 };

/** Heights are remembered for this many blocks per browser tab, newest kept. */
export const REMEMBERED_HEIGHTS_MAX = 500;
export const HEIGHTS_STORAGE_KEY = "qbbe-editor-block-heights";

export interface LazyBlockInfo {
  type: string;
  props?: Record<string, unknown>;
}

export function isLazyBlockType(type: string): type is LazyBlockType {
  return (LAZY_BLOCK_TYPES as readonly string[]).includes(type);
}

/**
 * Whether a block waits until it is near the screen. An embed with no address
 * shows its address form at once (there is nothing to load), and without an
 * IntersectionObserver (server render, old browsers) every block renders at
 * once, since nothing could tell it when to appear.
 */
export function shouldWait(block: LazyBlockInfo | null | undefined, canObserve: boolean): boolean {
  if (!canObserve || !block || !isLazyBlockType(block.type)) return false;
  if (block.type === "embed") return typeof block.props?.url === "string" && block.props.url.trim() !== "";
  return true;
}

/** The space a waiting block keeps: its last measured height, or an estimate. */
export function placeholderHeight(type: LazyBlockType, remembered: number | undefined): number {
  if (typeof remembered === "number" && Number.isFinite(remembered) && remembered > 0) return Math.round(remembered);
  return ESTIMATED_HEIGHT_PX[type];
}

/**
 * The words a waiting block shows, so the browser's find in page still
 * reaches it: a view's title, an embed's address.
 */
export function findableText(block: LazyBlockInfo): string {
  const props = block.props ?? {};
  if (block.type === "embed") return typeof props.url === "string" ? props.url.trim() : "";
  if (block.type === "query" && typeof props.spec === "string") {
    try {
      const spec = JSON.parse(props.spec) as { title?: unknown };
      return typeof spec.title === "string" ? spec.title.trim() : "";
    } catch {
      return "";
    }
  }
  return "";
}

/** Storage as the browser gives it; reads and writes may throw (private windows). */
export interface HeightStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readHeights(storage: HeightStorage | null | undefined): Map<string, number> {
  const heights = new Map<string, number>();
  if (!storage) return heights;
  try {
    const parsed = JSON.parse(storage.getItem(HEIGHTS_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return heights;
    for (const entry of parsed) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number" && entry[1] > 0) {
        heights.set(entry[0], entry[1]);
      }
    }
  } catch {
    // Unreadable or refused storage: estimates are used instead.
  }
  return heights;
}

/** Remembers a block's height, newest last, dropping the oldest past the limit. */
export function rememberHeight(heights: Map<string, number>, blockId: string, height: number): boolean {
  if (!(height > 0) || !Number.isFinite(height)) return false;
  const rounded = Math.round(height);
  if (heights.get(blockId) === rounded) return false;
  heights.delete(blockId);
  heights.set(blockId, rounded);
  while (heights.size > REMEMBERED_HEIGHTS_MAX) {
    const oldest = heights.keys().next().value as string;
    heights.delete(oldest);
  }
  return true;
}

export function writeHeights(storage: HeightStorage | null | undefined, heights: Map<string, number>): void {
  if (!storage) return;
  try {
    storage.setItem(HEIGHTS_STORAGE_KEY, JSON.stringify([...heights]));
  } catch {
    // Full or refused storage: heights are still remembered for this page.
  }
}
