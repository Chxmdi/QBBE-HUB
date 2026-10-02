"use client";

import "./e2-history.css";
import * as React from "react";
import { Keyboard, Redo2, Undo2 } from "lucide-react";
import { yUndoPluginKey } from "y-prosemirror";
import type * as Y from "yjs";
import { Dialog } from "@/components/ui/dialog";
import type { EditorT } from "@/features/editor/i18n";
import {
  EditorHistory,
  classifyChanges,
  isRemoteChange,
  savedElsewhere,
  type BlockChange,
  type ChangeKind,
  type UndoStackLike,
} from "@/features/editor/adapter/history/history";
import {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  bindingKeys,
  isMacPlatform,
  type KeyNames,
} from "@/features/editor/adapter/history/shortcuts";
import { announce } from "../multi-select";
import {
  NO_OPTIONS,
  NO_SPECS,
  type AnyBlockNoteEditor,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E2: undo history and the keyboard shortcuts dialog. Only E2 edits this file and e2-history.css.
 *
 * The steps themselves live in the editor's Yjs undo manager;
 * adapter/history/history.ts decides where a step ends and when the history
 * starts again. Here:
 *   Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y   undo and redo, announced
 *   Undo, Redo and Keyboard shortcuts buttons  after the editor
 *   ?  (outside any text field)                opens the shortcuts dialog
 * A save from elsewhere (the save queue's conflict) or a change that arrives
 * from another person through the document starts the history again.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE2Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e2BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E2InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export function E2Outside(props: EditorUnitProps) {
  if (!props.editable) return null;
  return <HistoryControls {...props} />;
}

function undoManagerOf(editor: AnyBlockNoteEditor): UndoStackLike | null {
  try {
    return (yUndoPluginKey.getState(editor.prosemirrorState)?.undoManager as UndoStackLike | undefined) ?? null;
  } catch {
    return null;
  }
}

/** A field where "?" and the undo keys belong to the text itself. */
function isTextField(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

/**
 * The editors on the page that answer "?"; only the newest one does, so a
 * task drawer's editor opened over a page shows one dialog, not two.
 */
const shortcutOwners: symbol[] = [];

/** Where the save queue reports its state, if this editor has one around it. */
function findSaveStatus(root: HTMLElement): { scope: HTMLElement; read: () => string | null } | null {
  let scope: HTMLElement | null = root.parentElement;
  for (let depth = 0; scope && depth < 3; depth += 1, scope = scope.parentElement) {
    const found = scope.querySelector<HTMLElement>("[data-save-status]");
    if (found) {
      const within = scope;
      return { scope: within, read: () => within.querySelector<HTMLElement>("[data-save-status]")?.getAttribute("data-save-status") ?? null };
    }
  }
  return null;
}

function useEditorHistory(editor: AnyBlockNoteEditor, doc: Y.Doc, containerRef: React.RefObject<HTMLDivElement | null>, t: EditorT) {
  const history = React.useMemo(() => new EditorHistory(() => undoManagerOf(editor)), [editor]);
  const [available, setAvailable] = React.useState({ undo: false, redo: false });
  const refresh = React.useCallback(() => {
    const next = { undo: history.canUndo(), redo: history.canRedo() };
    setAvailable((current) => (current.undo === next.undo && current.redo === next.redo ? current : next));
  }, [history]);

  // Where each step ends, and the opened state.
  React.useEffect(() => {
    const offBefore = editor.onBeforeChange(({ tr, getChanges }) => {
      if (!tr.docChanged) return;
      let kind: ChangeKind;
      try {
        kind = classifyChanges(getChanges() as unknown as BlockChange[]);
      } catch {
        // The editor cannot list a change whose new block has no id yet (it
        // is given one just after): that is a block being created.
        kind = { kind: "structure" };
      }
      history.beforeChange(kind);
    });
    const offChange = editor.onChange(() => {
      history.afterChange();
      refresh();
    });
    const opened = () => history.markOpened();
    const events = ["keydown", "pointerdown", "paste", "drop"] as const;
    events.forEach((name) => document.addEventListener(name, opened, true));
    return () => {
      offBefore();
      offChange?.();
      events.forEach((name) => document.removeEventListener(name, opened, true));
    };
  }, [editor, history, refresh]);

  const restart = React.useCallback(() => {
    if (history.restart()) announce(t("units.e2.announce.restarted"));
    refresh();
  }, [history, refresh, t]);

  // A change that arrives from someone else through the document.
  React.useEffect(() => {
    const onTransaction = (transaction: Y.Transaction) => {
      if (isRemoteChange(transaction)) restart();
    };
    doc.on("afterTransaction", onTransaction);
    return () => doc.off("afterTransaction", onTransaction);
  }, [doc, restart]);

  // A save from another window, reported by the save queue as a conflict.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const status = findSaveStatus(root);
    if (!status) return;
    let previous = status.read();
    const observer = new MutationObserver(() => {
      const now = status.read();
      if (savedElsewhere(previous, now)) restart();
      previous = now;
    });
    observer.observe(status.scope, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-save-status"] });
    return () => observer.disconnect();
  }, [containerRef, restart]);

  const run = React.useCallback(
    (which: "undo" | "redo") => {
      history.markOpened();
      const outcome = which === "undo" ? history.undo() : history.redo();
      if (outcome === "done") announce(t(which === "undo" ? "units.e2.announce.undone" : "units.e2.announce.redone"));
      else announce(t(which === "undo" ? "units.e2.announce.nothingToUndo" : "units.e2.announce.nothingToRedo"));
      refresh();
    },
    [history, refresh, t],
  );

  return { available, run };
}

function HistoryControls({ editor, doc, containerRef, t }: EditorUnitProps) {
  const { available, run } = useEditorHistory(editor, doc, containerRef, t);
  const [open, setOpen] = React.useState(false);
  const groupRef = React.useRef<HTMLDivElement>(null);

  // The undo keys, before the editor's own (which would undo without saying so).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target as HTMLElement | null;
      const editorEl = containerRef.current?.querySelector<HTMLElement>(".bn-editor");
      const inEditor = Boolean(target && editorEl?.contains(target) && !target.closest("input, textarea, select"));
      const onButtons = Boolean(target && groupRef.current?.contains(target));
      if (!inEditor && !onButtons) return;
      if (!editor.isEditable) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      run(key === "y" || event.shiftKey ? "redo" : "undo");
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor, containerRef, run]);

  // "?" outside the text opens the shortcuts.
  React.useEffect(() => {
    const me = Symbol("e2-shortcuts");
    shortcutOwners.push(me);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (shortcutOwners[shortcutOwners.length - 1] !== me) return;
      const target = event.target as HTMLElement | null;
      if (isTextField(target) || target?.closest?.("dialog[open]")) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      shortcutOwners.splice(shortcutOwners.indexOf(me), 1);
    };
  }, []);

  const mac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  const mod = mac ? "Meta" : "Control";
  return (
    <>
      <div ref={groupRef} role="group" aria-label={t("units.e2.toolbar.label")} className="qbbe-history-bar">
        <button
          type="button"
          className="qbbe-history-button"
          aria-disabled={!available.undo}
          aria-keyshortcuts={`${mod}+Z`}
          title={`${t("units.e2.toolbar.undo")} (${keysText(bindingKeys("Mod-z", mac, keyNames(t)))})`}
          onClick={() => run("undo")}
        >
          <Undo2 className="size-4" aria-hidden />
          {t("units.e2.toolbar.undo")}
        </button>
        <button
          type="button"
          className="qbbe-history-button"
          aria-disabled={!available.redo}
          aria-keyshortcuts={`${mod}+Shift+Z Control+Y`}
          title={`${t("units.e2.toolbar.redo")} (${keysText(bindingKeys("Shift-Mod-z", mac, keyNames(t)))})`}
          onClick={() => run("redo")}
        >
          <Redo2 className="size-4" aria-hidden />
          {t("units.e2.toolbar.redo")}
        </button>
        <button
          type="button"
          className="qbbe-history-button"
          aria-haspopup="dialog"
          aria-keyshortcuts="Shift+?"
          onClick={() => setOpen(true)}
        >
          <Keyboard className="size-4" aria-hidden />
          {t("units.e2.toolbar.shortcuts")}
        </button>
      </div>
      {open ? <ShortcutsDialog t={t} mac={mac} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function keyNames(t: EditorT): KeyNames {
  return {
    shift: t("units.e2.shortcuts.keyNames.shift"),
    escape: t("units.e2.shortcuts.keyNames.escape"),
    enter: t("units.e2.shortcuts.keyNames.enter"),
    up: t("units.e2.shortcuts.keyNames.up"),
    down: t("units.e2.shortcuts.keyNames.down"),
    then: t("units.e2.shortcuts.keyNames.then"),
  };
}

function keysText(keys: string[]): string {
  return keys.join("+");
}

/** The dialog listing every shortcut, grouped, with the keys for this platform. */
export function ShortcutsDialog({ t, mac, onClose }: { t: EditorT; mac: boolean; onClose: () => void }) {
  const names = keyNames(t);
  return (
    <Dialog open onClose={onClose} title={t("units.e2.shortcuts.title")}>
      <p className="mb-3 text-body-sm text-muted">{t("units.e2.shortcuts.intro")}</p>
      {/* Focusable so the list scrolls from the keyboard. */}
      <div
        className="qbbe-shortcuts"
        role="region"
        aria-label={t("units.e2.shortcuts.title")}
        tabIndex={0}
        data-testid="editor-shortcuts"
      >
        {SHORTCUT_GROUPS.map((group) => (
          <table key={group} className="qbbe-shortcuts-table">
            <caption>{t(`units.e2.shortcuts.groups.${group}`)}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">{t("units.e2.shortcuts.action")}</th>
                <th scope="col">{t("units.e2.shortcuts.keys")}</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <tr key={shortcut.id} data-shortcut={shortcut.id}>
                  <th scope="row">{t(`units.e2.shortcuts.items.${shortcut.id}`)}</th>
                  <td>
                    {shortcut.bindings.map((binding, index) => (
                      <React.Fragment key={binding}>
                        {index > 0 ? <span className="qbbe-shortcuts-or"> {t("units.e2.shortcuts.or")} </span> : null}
                        <span className="qbbe-shortcuts-keys">
                          {bindingKeys(binding, mac, names).map((key, keyIndex) =>
                            key === names.then ? (
                              <span key={keyIndex} className="qbbe-shortcuts-or"> {key} </span>
                            ) : (
                              <kbd key={keyIndex}>{key}</kbd>
                            ),
                          )}
                        </span>
                      </React.Fragment>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </Dialog>
  );
}
