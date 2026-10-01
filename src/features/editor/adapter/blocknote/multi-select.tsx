"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Baseline, Copy, PaintBucket, Pilcrow, Trash2 } from "lucide-react";
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { Menu } from "@/components/ui/menu";
import type { EditorT } from "@/features/editor/i18n";
import { blockText, type EditorBlock } from "@/features/editor/adapter/content";
import {
  cloneBlock,
  movePlacement,
  selectedSiblings,
  selectRange,
  type MoveDirection,
  type MovePlacement,
} from "@/features/editor/adapter/selection";
import { textTypes, turnIntoTargets } from "@/features/editor/registry";

/**
 * Several blocks at once (U4): the selection model, the keys that drive it,
 * and the floating bar of bulk actions. The actions here are the only way the
 * block handle menu, the bulk bar and the Ctrl+/ block menu change blocks,
 * so a block behaves the same whichever surface it is reached from.
 *
 * Keys (on a capture listener, so they run before the editor's own):
 *   Shift+Click        extends the selection from the cursor's block
 *   Shift+Up/Down      extends it one block at a time (the editor's own text
 *                      selection; this file steps in only where that cannot
 *                      reach, such as a divider)
 *   Alt+Up/Down        moves the selected blocks, or the cursor's block
 *   Alt+F10            moves to the selection bar (then to the formatting toolbar)
 *   Escape             clears the selection
 */

// The schema's block types are not visible here; the editor is used through
// the operations every BlockNote editor has, with loosely typed blocks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEditor = BlockNoteEditor<any, any, any>;
type AnyBlock = { id: string; type: string; props: Record<string, unknown> } & EditorBlock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPartialBlock = PartialBlock<any, any, any>;

/** Blocks that can be turned into one another, from the block registry (U2). */
const TEXT_TYPES = textTypes();

export const COLORS = ["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;
export type ColorKey = (typeof COLORS)[number];

export function announce(text: string) {
  const live = document.getElementById("qbbe-editor-live");
  if (live) {
    // The same text twice must still be read out.
    live.textContent = "";
    live.textContent = text;
  }
}

/** "1 block deleted." or "3 blocks deleted." */
export function countText(t: EditorT, what: "duplicated" | "deleted", count: number): string {
  return count === 1 ? t(`select.${what}One`) : t(`select.${what}`, { count });
}

/** The block's first line, for announcements. */
export function blockTitle(block: EditorBlock | undefined, t: EditorT): string {
  const text = block ? blockText({ ...block, children: [] }).trim().split("\n")[0] : "";
  return text.slice(0, 80) || t("select.untitled");
}

/**
 * Blocks held as selected outside the editor's own text selection (a run
 * that includes a divider or an image), per editor, so every menu sees them.
 */
const held = new WeakMap<AnyEditor, string[]>();

/**
 * The ids of the editor's own selection when it spans several blocks,
 * narrowed to the blocks every action applies to: those sharing the first
 * selected block's list of siblings.
 */
export function selectionIds(editor: AnyEditor): string[] {
  try {
    const blocks = editor.getSelection()?.blocks as AnyBlock[] | undefined;
    if (!blocks || blocks.length < 2) return [];
    const chosen = selectedSiblings(editor.document as EditorBlock[], blocks.map((block) => block.id)).chosen;
    return chosen.length > 1 ? chosen.map((block) => block.id!) : [];
  } catch {
    return [];
  }
}

/** The current multi-block selection, whichever way it was made. */
export function currentSelection(editor: AnyEditor): string[] {
  const kept = held.get(editor);
  return kept && kept.length > 0 ? kept : selectionIds(editor);
}

/**
 * The ids an action on `blockId` applies to: the whole selection when the
 * block is part of it, otherwise that block alone.
 */
export function idsFor(editor: AnyEditor, blockId: string): string[] {
  const selected = currentSelection(editor);
  return selected.includes(blockId) ? selected : [blockId];
}

function chosenOf(editor: AnyEditor, ids: string[]): EditorBlock[] {
  return selectedSiblings(editor.document as EditorBlock[], ids).chosen;
}

export function deleteBlocks(editor: AnyEditor, ids: string[]): number {
  const chosen = chosenOf(editor, ids);
  if (chosen.length === 0) return 0;
  editor.removeBlocks(chosen.map((block) => block.id!));
  return chosen.length;
}

export function duplicateBlocks(editor: AnyEditor, ids: string[]): number {
  const chosen = chosenOf(editor, ids);
  if (chosen.length === 0) return 0;
  editor.insertBlocks(chosen.map(cloneBlock) as AnyPartialBlock[], chosen[chosen.length - 1].id!, "after");
  return chosen.length;
}

/**
 * Moves the blocks one step and returns where they went (null at the end of
 * the document). The editor moves its own selection as one unit; any other
 * set of blocks is moved block by block in an order that keeps them together.
 */
export function moveBlocks(editor: AnyEditor, ids: string[], direction: MoveDirection): MovePlacement | null {
  const placement = movePlacement(editor.document as EditorBlock[], ids, direction);
  if (!placement) return null;
  const selected = selectionIds(editor);
  const sameSet = selected.length === ids.length && ids.every((id) => selected.includes(id));
  editor.transact(() => {
    if (sameSet) {
      if (direction === "up") editor.moveBlocksUp();
      else editor.moveBlocksDown();
      return;
    }
    const chosen = chosenOf(editor, ids);
    const ordered = direction === "up" ? chosen : [...chosen].reverse();
    for (const block of ordered) {
      if (direction === "up") editor.moveBlocksUp(block.id!);
      else editor.moveBlocksDown(block.id!);
    }
  });
  return placement;
}

export function turnBlocksInto(editor: AnyEditor, ids: string[], target: AnyPartialBlock): number {
  const text = chosenOf(editor, ids).filter((block) => TEXT_TYPES.has(block.type));
  editor.transact(() => {
    for (const block of text) editor.updateBlock(block.id!, target);
  });
  return text.length;
}

/** Whether a block type carries text and background colours. */
export function hasColors(editor: AnyEditor, type: string): boolean {
  const props = (editor.schema.blockSchema as Record<string, { propSchema?: Record<string, unknown> }>)[type]?.propSchema ?? {};
  return "textColor" in props || "backgroundColor" in props;
}

export function colorBlocks(editor: AnyEditor, ids: string[], color: { textColor?: ColorKey; backgroundColor?: ColorKey }): number {
  const able = chosenOf(editor, ids).filter((block) => hasColors(editor, block.type));
  editor.transact(() => {
    for (const block of able) editor.updateBlock(block.id!, { props: color });
  });
  return able.length;
}

/** The address "Copy link" puts on the clipboard. */
export function blockLink(objectPath: string | undefined, blockId: string): string {
  if (!objectPath) return blockId;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}${objectPath}#block-${blockId}`;
}

export async function copyBlockLink(objectPath: string | undefined, blockId: string, t: EditorT): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(blockLink(objectPath, blockId));
    announce(t("handle.linkCopied"));
    return true;
  } catch {
    announce(t("handle.linkFailed"));
    return false;
  }
}

/** Moves the blocks, announces the landing place and lights the rows they now sit on. */
export function moveAndAnnounce(editor: AnyEditor, ids: string[], direction: MoveDirection, t: EditorT, light?: (ids: string[]) => void): boolean {
  const placement = moveBlocks(editor, ids, direction);
  if (!placement) {
    announce(t(direction === "up" ? "select.atTop" : "select.atBottom"));
    return false;
  }
  const reference = editor.getBlock(placement.referenceId) as EditorBlock | undefined;
  announce(t(placement.placement === "before" ? "select.movedAbove" : "select.movedBelow", { title: blockTitle(reference, t) }));
  light?.(ids);
  return true;
}

const BLOCK = "[data-node-type='blockOuter'][data-id]";

interface Row {
  id: string;
  top: number;
  height: number;
}

function rowsFor(root: HTMLElement, ids: string[]): Row[] {
  const base = root.getBoundingClientRect();
  return ids.flatMap((id) => {
    const el = root.querySelector<HTMLElement>(`[data-node-type='blockOuter'][data-id="${CSS.escape(id)}"]`);
    if (!el) return [];
    const rect = el.getBoundingClientRect();
    return [{ id, top: rect.top - base.top, height: rect.height }];
  });
}

/**
 * Follows a copied block link: with `#block-<id>` in the address, that block
 * is scrolled into view, briefly lit and given the cursor.
 */
function useBlockHash(editor: AnyEditor, containerRef: React.RefObject<HTMLElement | null>, light: (ids: string[]) => void) {
  React.useEffect(() => {
    const follow = () => {
      const match = /^#block-([\w-]+)$/.exec(window.location.hash);
      const root = containerRef.current;
      if (!match || !root) return;
      const id = match[1];
      const el = root.querySelector<HTMLElement>(`[data-node-type='blockOuter'][data-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      light([id]);
      try {
        editor.setTextCursorPosition(id, "start");
      } catch {
        // A block without text is still scrolled to and lit.
      }
    };
    // The document renders a moment after the editor mounts.
    const timer = setTimeout(follow, 300);
    window.addEventListener("hashchange", follow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", follow);
    };
  }, [editor, containerRef, light]);
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The selection model. Usually it mirrors the editor's own text selection
 * when that spans more than one block. Blocks the editor cannot put a text
 * selection in (a divider, an image) are held here instead, as plain ids.
 */
function useBlockSelection(editor: AnyEditor, containerRef: React.RefObject<HTMLElement | null>, t: EditorT, enabled: boolean) {
  const [derived, setDerived] = React.useState<string[]>([]);
  const [manual, setManual] = React.useState<string[] | null>(null);
  const [lit, setLit] = React.useState<string[]>([]);
  const [version, setVersion] = React.useState(0);
  const anchor = React.useRef<string | null>(null);
  const ids = manual ?? derived;
  const idsRef = React.useRef(ids);
  const manualRef = React.useRef(manual);
  React.useLayoutEffect(() => {
    idsRef.current = ids;
    manualRef.current = manual;
    if (manual && manual.length > 0) held.set(editor, manual);
    else held.delete(editor);
  }, [editor, ids, manual]);

  const cursorBlockId = React.useCallback((): string | null => {
    try {
      return (editor.getTextCursorPosition().block as AnyBlock).id;
    } catch {
      return null;
    }
  }, [editor]);

  const clear = React.useCallback(() => {
    const last = idsRef.current[idsRef.current.length - 1];
    setManual(null);
    setLit([]);
    if (last) {
      try {
        editor.setTextCursorPosition(last, "end");
      } catch {
        // A block without text keeps whatever selection the editor has.
      }
    }
    announce(t("select.cleared"));
    editor.focus();
  }, [editor, t]);

  const light = React.useCallback((moved: string[]) => setLit(moved), []);

  React.useEffect(() => {
    if (!enabled) return;
    const offSelection = editor.onSelectionChange(() => {
      const next = selectionIds(editor);
      setDerived((prev) => (sameIds(prev, next) ? prev : next));
      setManual(null);
      if (next.length === 0) anchor.current = cursorBlockId();
    });
    const offChange = editor.onChange(() => setVersion((n) => n + 1));
    return () => {
      offSelection();
      offChange();
    };
  }, [editor, enabled, cursorBlockId]);

  // Shift+Click extends from the anchor to the clicked block.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;
    const onMouseDown = (event: MouseEvent) => {
      setLit([]);
      if (!event.shiftKey || event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (!root.querySelector(".bn-editor")?.contains(target)) return;
      const focus = target.closest<HTMLElement>(BLOCK)?.getAttribute("data-id");
      const from = anchor.current ?? cursorBlockId();
      if (!focus || !from || focus === from) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        editor.setSelection(from, focus);
      } catch {
        const range = selectRange(editor.document as EditorBlock[], from, focus);
        if (range.length > 1) setManual(range);
      }
      editor.focus();
    };
    root.addEventListener("mousedown", onMouseDown, true);
    return () => root.removeEventListener("mousedown", onMouseDown, true);
  }, [editor, containerRef, enabled, cursorBlockId]);

  // Keys, before the editor sees them. Everything the handler needs is read
  // through refs so it is registered once, ahead of the editor's own keys.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editorEl = root.querySelector<HTMLElement>(".bn-editor");
      const inEditor = Boolean(editorEl?.contains(target));
      const inBar = Boolean(target.closest?.(".qbbe-bulk-bar"));
      if (!inEditor && !inBar) return;
      const current = idsRef.current;
      const manualNow = manualRef.current;
      const take = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const direction: MoveDirection | null = event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : null;
      const moving = direction !== null && event.altKey && !event.ctrlKey && !event.metaKey;
      if (!moving && !["Shift", "Control", "Alt", "Meta"].includes(event.key)) setLit([]);
      if (event.key === "Escape" && inBar) {
        take();
        editor.focus();
        return;
      }
      if (event.key === "Escape" && inEditor && current.length > 0) {
        take();
        clear();
        return;
      }
      if (event.key === "F10" && event.altKey) {
        const bar = root.querySelector<HTMLElement>(".qbbe-bulk-bar button");
        if (inEditor && bar) {
          take();
          bar.focus();
        } else if (inBar) {
          take();
          const toolbar = document.querySelector<HTMLElement>(".bn-formatting-toolbar button:not([disabled]), .bn-formatting-toolbar [role=combobox]");
          (toolbar ?? editorEl)?.focus();
        }
        return;
      }
      if (!inEditor || !direction) return;
      if (moving) {
        take();
        const cursor = cursorBlockId();
        const ids = current.length > 0 ? current : cursor ? [cursor] : [];
        if (ids.length === 0) return;
        moveAndAnnounce(editor, ids, direction, t, light);
        if (manualNow) setManual(ids);
        return;
      }
      // Shift+Arrow on a selection the editor itself cannot extend.
      if (event.shiftKey && manualNow && manualNow.length > 0) {
        take();
        const from = anchor.current ?? manualNow[0];
        const focusId = manualNow[manualNow.length - 1] === from && manualNow.length > 1 ? manualNow[0] : manualNow[manualNow.length - 1];
        const neighbour = direction === "up" ? editor.getPrevBlock(focusId) : editor.getNextBlock(focusId);
        if (!neighbour) return;
        const range = selectRange(editor.document as EditorBlock[], from, (neighbour as AnyBlock).id);
        if (range.length > 0) setManual(range);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor, containerRef, enabled, clear, cursorBlockId, light, t]);

  return { ids, clear, version, lit, light };
}

/**
 * The selection's visible side: a tint on each selected row, the rows the
 * last move landed on, and the bar of bulk actions above the selection.
 */
export function MultiSelect({
  editor,
  containerRef,
  t,
  enabled,
  onBarChange,
}: {
  editor: AnyEditor;
  containerRef: React.RefObject<HTMLDivElement | null>;
  t: EditorT;
  enabled: boolean;
  /** Told whether the bulk bar is showing, so the formatting toolbar can make room for it. */
  onBarChange?: (showing: boolean) => void;
}) {
  const { ids, clear, version, lit, light } = useBlockSelection(editor, containerRef, t, enabled);
  const showing = enabled && ids.length > 0;
  React.useEffect(() => {
    onBarChange?.(showing);
  }, [onBarChange, showing]);
  useBlockHash(editor, containerRef, light);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [litRows, setLitRows] = React.useState<Row[]>([]);

  React.useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const measure = () => {
      setRows(rowsFor(root, ids));
      setLitRows(rowsFor(root, lit));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [containerRef, ids, lit, version]);

  if (!enabled) return null;
  const last = rows[rows.length - 1];
  const act = (run: () => void) => {
    run();
    requestAnimationFrame(() => editor.focus());
  };
  const count = ids.length;
  const typeOf = (id: string) => (editor.getBlock(id) as AnyBlock | undefined)?.type ?? "";
  const canTurn = ids.some((id) => TEXT_TYPES.has(typeOf(id)));
  const canColor = ids.some((id) => hasColors(editor, typeOf(id)));
  const colorItems = (prop: "textColor" | "backgroundColor") =>
    COLORS.map((color) => ({
      label: t(`colors.${color}`),
      icon: (
        <span
          aria-hidden
          className="qbbe-color-dot"
          style={color === "default" ? undefined : { background: `var(--bn-colors-highlights-${color}-${prop === "textColor" ? "text" : "background"})` }}
        />
      ),
      onSelect: () => act(() => colorBlocks(editor, ids, { [prop]: color })),
    }));

  return (
    <>
      {rows.map((row) => (
        <div key={`sel-${row.id}`} aria-hidden className="qbbe-selected-row" style={{ top: row.top, height: row.height }} />
      ))}
      {litRows.map((row) => (
        <div key={`lit-${row.id}`} aria-hidden className="qbbe-drop-target" data-testid="drop-target" style={{ top: row.top, height: row.height }} />
      ))}
      {count > 0 && last ? (
        <div
          role="toolbar"
          aria-label={t("select.label")}
          className="qbbe-bulk-bar"
          // Below the selection: the formatting toolbar takes the space above it.
          style={{ top: last.top + last.height + 6 }}
        >
          <span className="qbbe-bulk-count">{t("select.count", { count })}</span>
          <button type="button" className="qbbe-bulk-button" aria-label={t("handle.moveUp")} title={t("handle.moveUp")} onClick={() => act(() => moveAndAnnounce(editor, ids, "up", t, light))}>
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button type="button" className="qbbe-bulk-button" aria-label={t("handle.moveDown")} title={t("handle.moveDown")} onClick={() => act(() => moveAndAnnounce(editor, ids, "down", t, light))}>
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            className="qbbe-bulk-button"
            aria-label={t("handle.duplicate")}
            title={t("handle.duplicate")}
            onClick={() => act(() => announce(countText(t, "duplicated", duplicateBlocks(editor, ids))))}
          >
            <Copy className="size-4" aria-hidden />
          </button>
          {canTurn ? (
            <Menu
              label={t("handle.turnInto")}
              align="left"
              trigger={<Pilcrow className="size-4" aria-hidden />}
              items={turnIntoTargets().map(({ labelKey, block }) => ({
                label: t(labelKey),
                onSelect: () => act(() => turnBlocksInto(editor, ids, block)),
              }))}
            />
          ) : null}
          {canColor ? (
            <>
              <Menu label={t("handle.textColor")} align="left" trigger={<Baseline className="size-4" aria-hidden />} items={colorItems("textColor")} />
              <Menu label={t("handle.backgroundColor")} align="left" trigger={<PaintBucket className="size-4" aria-hidden />} items={colorItems("backgroundColor")} />
            </>
          ) : null}
          <button
            type="button"
            className="qbbe-bulk-button text-danger-fg"
            aria-label={t("handle.delete")}
            title={t("handle.delete")}
            onClick={() => act(() => announce(countText(t, "deleted", deleteBlocks(editor, ids))))}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
          <button type="button" className="qbbe-bulk-button qbbe-bulk-text" onClick={clear}>
            {t("select.clear")}
          </button>
        </div>
      ) : null}
    </>
  );
}
