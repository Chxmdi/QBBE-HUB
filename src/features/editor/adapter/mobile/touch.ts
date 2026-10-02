/**
 * Wave 2 unit E4: the rules behind mobile editing, kept free of React and the
 * DOM so they can be tested on their own.
 */

/**
 * Phone widths. Mobile editing never turns on above this, whatever the
 * device, so desktop and tablet layouts stay exactly as they were (E4-4).
 */
export const MOBILE_QUERY = "(max-width: 767px)";

/** The attribute set on <html> while mobile editing is on; the CSS keys off it. */
export const MOBILE_ATTRIBUTE = "data-qbbe-mobile-editing";

/** The CSS variable on <html> holding the height fixed over the screen's bottom. */
export const BOTTOM_INSET = "--qbbe-mobile-bottom-inset";

/** The touch toolbar's formatting buttons, in order. */
export const FORMAT_ACTIONS = ["bold", "italic", "link", "bulletList", "checkList", "heading", "undo", "redo"] as const;
/** Its buttons that act on the whole block, in order. */
export const BLOCK_ACTIONS = ["moveUp", "moveDown", "blockMenu"] as const;

export type FormatAction = (typeof FORMAT_ACTIONS)[number];
export type BlockAction = (typeof BLOCK_ACTIONS)[number];

/** The block types the list, checklist and heading buttons switch to. */
export type ToggleAction = Extract<FormatAction, "bulletList" | "checkList" | "heading">;

const TARGETS: Record<ToggleAction, { type: string; props?: Record<string, unknown> }> = {
  bulletList: { type: "bulletListItem" },
  checkList: { type: "checkListItem" },
  heading: { type: "heading", props: { level: 2 } },
};

/** Whether the block is already what the button would turn it into. */
export function isToggleActive(action: ToggleAction, type: string): boolean {
  return TARGETS[action].type === type;
}

/**
 * What the block becomes when its button is pressed: the button's type, or a
 * paragraph again when it already is that type (so each button toggles).
 */
export function toggleTarget(action: ToggleAction, type: string): { type: string; props?: Record<string, unknown> } {
  return isToggleActive(action, type) ? { type: "paragraph" } : TARGETS[action];
}

/**
 * A link address typed on a phone, made safe: web and mail addresses only.
 * A bare domain gets https://. Anything else (javascript:, data:, spaces in
 * the host) is refused with null.
 */
export function safeLinkHref(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return url.pathname.includes("@") ? url.href : null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  return url.href;
}

/**
 * Roving focus in the toolbar (the ARIA toolbar pattern): arrows move one
 * button and wrap, Home and End jump to the ends. Other keys leave it alone
 * (null).
 */
export function nextToolbarIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * How many editors on the page are in mobile mode. The <html> attribute stays
 * while at least one is, so a second editor unmounting does not switch the
 * styles off for the first.
 */
export class MobileCounter {
  private count = 0;
  constructor(private readonly apply: (on: boolean) => void) {}
  enter(): () => void {
    this.count += 1;
    if (this.count === 1) this.apply(true);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      this.count -= 1;
      if (this.count === 0) this.apply(false);
    };
  }
}
