import type { Awareness } from "y-protocols/awareness";

/**
 * The awareness the editor's cursor plugin is given (wave 2, C1).
 *
 * The cursor plugin (y-prosemirror) redraws the other people's cursors by
 * dispatching an editor transaction on every awareness "change", including
 * the ones this copy makes itself each time its own cursor moves or the text
 * loses focus. Every editor transaction makes the sync plugin write the
 * editor's document into Yjs as an undoable step. After an undo that takes a
 * new page back to empty (its first step holds the page's first block), the
 * editor shows a fresh empty block that Yjs does not have, so that write adds
 * a step of its own: the redo history is lost and Undo keeps saying "Undone."
 * past the page as it was opened (wave 2, E2).
 *
 * Only other people's cursors are drawn, so only a change that touches
 * another copy needs a redraw. This view of the awareness passes those on and
 * keeps this copy's own changes from the plugin; everything else is the
 * awareness itself.
 */
type ChangeListener = (change: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => void;

export function othersOnlyAwareness(awareness: Awareness): Awareness {
  const wrapped = new Map<ChangeListener, ChangeListener>();
  const touchesOthers = (change: { added: number[]; updated: number[]; removed: number[] }) =>
    [change.added, change.updated, change.removed].some((ids) => ids.some((id) => id !== awareness.clientID));
  const on = (name: string, listener: ChangeListener) => {
    if (name !== "change") return awareness.on(name as "change", listener);
    const filtered: ChangeListener = (change, origin) => {
      if (touchesOthers(change)) listener(change, origin);
    };
    wrapped.set(listener, filtered);
    awareness.on("change", filtered);
  };
  const off = (name: string, listener: ChangeListener) => {
    if (name !== "change") return awareness.off(name as "change", listener);
    const filtered = wrapped.get(listener);
    wrapped.delete(listener);
    awareness.off("change", filtered ?? listener);
  };
  return new Proxy(awareness, {
    get(target, key) {
      if (key === "on") return on;
      if (key === "off") return off;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
