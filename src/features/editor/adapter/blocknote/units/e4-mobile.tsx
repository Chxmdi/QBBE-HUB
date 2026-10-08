"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  MoreHorizontal,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { FormattingToolbarExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import { announce, idsFor, moveAndAnnounce, turnBlocksInto } from "../multi-select";
import {
  BLOCK_ACTIONS,
  BOTTOM_INSET,
  FORMAT_ACTIONS,
  bottomInset,
  MOBILE_ATTRIBUTE,
  MOBILE_QUERY,
  MobileCounter,
  isToggleActive,
  nextToolbarIndex,
  safeLinkHref,
  toggleTarget,
  type BlockAction,
  type FormatAction,
} from "../../mobile/touch";
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
 * Wave 2 unit E4: mobile editing, behind the `wos_editor` and `wos_mobile`
 * switches. At phone widths (MOBILE_QUERY) an editable editor gets a touch
 * toolbar while it has focus: bold, italic, link, bulleted list, checklist,
 * heading, undo and redo, then move the block up or down and open the block
 * menu. While mobile editing is on, <html> carries MOBILE_ATTRIBUTE, which
 * e4-mobile.css uses to keep the editor and its menus inside the screen. At
 * desktop widths, or with either switch off, nothing here renders and the
 * attribute is never set, so the editor is exactly as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE4Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e4BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E4InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export function E4Outside(props: EditorUnitProps) {
  const on = useMobileEditing(props.editable);
  if (!on || !props.editable) return null;
  return <MobileEditing {...props} />;
}

// One answer per page load, shared by every editor on the page. Only a failed
// request (no answer, or an error status) is forgotten, so the next editor
// that mounts asks again; until then the editor stays as on desktop.
let switchRequest: Promise<boolean> | null = null;

function mobileSwitchOn(): Promise<boolean> {
  switchRequest ??= fetch("/api/editor/mobile", { cache: "no-store", credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`mobile editing switch: ${response.status}`);
      return ((await response.json()) as { enabled?: unknown }).enabled === true;
    })
    .catch(() => {
      switchRequest = null;
      return false;
    });
  return switchRequest;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const read = () => setNarrow(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);
  return narrow;
}

/**
 * Both switches on and a phone-width screen. The switches are asked about
 * only once an editable editor is at phone width.
 */
function useMobileEditing(editable: boolean): boolean {
  const narrow = useNarrow();
  const [switchOn, setSwitchOn] = React.useState(false);
  React.useEffect(() => {
    if (!narrow || !editable || switchOn) return;
    let live = true;
    void mobileSwitchOn().then((enabled) => {
      if (live) setSwitchOn(enabled);
    });
    return () => {
      live = false;
    };
  }, [narrow, editable, switchOn]);
  return narrow && switchOn;
}

/**
 * Page-wide state while at least one editor is in mobile mode: the <html>
 * attribute the styles key off, and one watcher of the bottom inset.
 */
let stopInset: (() => void) | null = null;
const pageMobileMode = new MobileCounter((on) => {
  if (on) {
    document.documentElement.setAttribute(MOBILE_ATTRIBUTE, "");
    stopInset = watchBottomInset();
  } else {
    document.documentElement.removeAttribute(MOBILE_ATTRIBUTE);
    stopInset?.();
    stopInset = null;
  }
});

function MobileEditing(props: EditorUnitProps) {
  React.useEffect(() => pageMobileMode.enter(), []);
  const focused = useFocusWithin(props.containerRef);
  const [linkOpen, setLinkOpen] = React.useState(false);
  useToolbarShortcut(props.containerRef);
  return (
    <>
      {focused || linkOpen ? <TouchToolbar {...props} onLink={() => setLinkOpen(true)} /> : null}
      {linkOpen ? <LinkDialog editor={props.editor} t={props.t} onClose={() => setLinkOpen(false)} /> : null}
    </>
  );
}

/**
 * Keeps BOTTOM_INSET on <html> at the height covering the bottom of the
 * screen: the workspace's fixed phone navigation (whose labels can wrap to
 * two lines) or the on-screen keyboard, whichever is taller, so the toolbar
 * sticks just above it. Returns the function that stops watching.
 */
function watchBottomInset(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  let observed: Element[] = [];
  let written = "";
  let frame = 0;
  // Measured at most once a frame, and written only when it changes: the
  // inset can change the navigation's own size, which would otherwise call
  // this again at once, every frame (a resize in Firefox never settled).
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  const resize = new ResizeObserver(schedule);
  function measure() {
    const fixed = [...document.querySelectorAll<HTMLElement>("body nav")].filter((el) => {
      if (getComputedStyle(el).position !== "fixed" || el.getClientRects().length === 0) return false;
      return el.getBoundingClientRect().bottom >= window.innerHeight - 1;
    });
    const navTop = fixed.length ? Math.min(...fixed.map((el) => el.getBoundingClientRect().top)) : undefined;
    const visibleBottom = viewport ? viewport.offsetTop + viewport.height : undefined;
    const value = `${bottomInset({ innerHeight: window.innerHeight, navTop, visibleBottom })}px`;
    if (value !== written) {
      written = value;
      root.style.setProperty(BOTTOM_INSET, value);
    }
    if (fixed.length !== observed.length || fixed.some((el, i) => el !== observed[i])) {
      resize.disconnect();
      fixed.forEach((el) => resize.observe(el));
      observed = fixed;
    }
  }
  measure();
  window.addEventListener("resize", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  return () => {
    window.removeEventListener("resize", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    cancelAnimationFrame(frame);
    resize.disconnect();
    root.style.removeProperty(BOTTOM_INSET);
  };
}

/**
 * Alt+F10 from the text moves to the touch toolbar when the floating
 * formatting toolbar is not showing (the editor sends it there when it is),
 * so a keyboard reaches every touch button too.
 */
function useToolbarShortcut(ref: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F10" || !event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (!target.closest?.(".bn-editor")) return;
      const button = root.querySelector<HTMLElement>(".qbbe-touch-toolbar button[tabindex='0']");
      if (!button) return;
      event.preventDefault();
      button.focus();
    };
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}

/**
 * Whether focus is inside the editor's container, other than on the undo and
 * redo bar. That bar has its own buttons: counting it raised the toolbar the
 * moment one was pressed, over the button itself when it sat near the bottom
 * of a phone screen, so the tap ended on the toolbar and did nothing.
 */
function useFocusWithin(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inside, setInside] = React.useState(false);
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const read = () => {
      const active = document.activeElement;
      setInside(root.contains(active) && !active?.closest(".qbbe-history-bar"));
    };
    read();
    const onOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      // Focus can pass through <body> on its way to the next element.
      requestAnimationFrame(read);
    };
    root.addEventListener("focusin", read);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("focusin", read);
      root.removeEventListener("focusout", onOut);
    };
  }, [ref]);
  return inside;
}

/**
 * Re-renders after every editor transaction: content, selection, and also the
 * marks Bold or Italic arm for the next typed text when nothing is selected,
 * which change neither the content nor the selection.
 */
function useEditorVersion(editor: AnyBlockNoteEditor): number {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    const bump = () => setVersion((n) => n + 1);
    const tiptap = editor._tiptapEditor;
    tiptap.on("transaction", bump);
    return () => {
      tiptap.off("transaction", bump);
    };
  }, [editor]);
  return version;
}

/** Whether the slash menu or the floating formatting toolbar is showing. */
function useMenuShowing(editor: AnyBlockNoteEditor): boolean {
  const [showing, setShowing] = React.useState(false);
  React.useEffect(() => {
    const slash = editor.getExtension(SuggestionMenu);
    const formatting = editor.getExtension(FormattingToolbarExtension);
    const read = () => setShowing(Boolean(slash?.store.state?.show) || Boolean(formatting?.store.state));
    read();
    const offSlash = slash?.store.subscribe(read);
    const offFormatting = formatting?.store.subscribe(read);
    return () => {
      offSlash?.();
      offFormatting?.();
    };
  }, [editor]);
  return showing;
}

/**
 * Closes the slash menu and the formatting toolbar, then puts focus back in
 * the text: the Close button goes away with the menus, and focus must not go
 * with it.
 */
function closeMenus(editor: AnyBlockNoteEditor) {
  editor.getExtension(SuggestionMenu)?.closeMenu();
  editor.getExtension(FormattingToolbarExtension)?.store.setState(false);
  editor.focus();
}

const ICONS: Record<FormatAction | BlockAction, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  bold: Bold,
  italic: Italic,
  link: Link2,
  bulletList: List,
  checkList: ListChecks,
  heading: Heading2,
  undo: Undo2,
  redo: Redo2,
  moveUp: ArrowUp,
  moveDown: ArrowDown,
  blockMenu: MoreHorizontal,
};

function TouchToolbar({ editor, t, onLink }: EditorUnitProps & { onLink: () => void }) {
  useEditorVersion(editor);
  const menuShowing = useMenuShowing(editor);
  const [focusIndex, setFocusIndex] = React.useState(0);
  const toolbarRef = React.useRef<HTMLDivElement>(null);

  const block = editor.getTextCursorPosition().block;
  const styles = editor.getActiveStyles() as { bold?: boolean; italic?: boolean };

  const pressed = (action: FormatAction): boolean | undefined => {
    if (action === "bold") return Boolean(styles.bold);
    if (action === "italic") return Boolean(styles.italic);
    if (action === "bulletList" || action === "checkList" || action === "heading") return isToggleActive(action, block.type);
    return undefined;
  };

  const run = (action: FormatAction | BlockAction) => {
    switch (action) {
      case "bold":
        editor.toggleStyles({ bold: true });
        return;
      case "italic":
        editor.toggleStyles({ italic: true });
        return;
      case "link":
        onLink();
        return;
      case "bulletList":
      case "checkList":
      case "heading": {
        turnBlocksInto(editor, idsFor(editor, block.id), toggleTarget(action, block.type) as never);
        return;
      }
      case "undo":
        if (!editor.undo()) announce(t("units.e4.nothingToUndo"));
        return;
      case "redo":
        if (!editor.redo()) announce(t("units.e4.nothingToRedo"));
        return;
      case "moveUp":
      case "moveDown":
        if (moveAndAnnounce(editor, idsFor(editor, block.id), action === "moveUp" ? "up" : "down", t)) {
          // The caret stays with the block it was in, so the next tap moves
          // the same block again.
          if (editor.getTextCursorPosition().block.id !== block.id) editor.setTextCursorPosition(block.id, "end");
          requestAnimationFrame(() => scrollCursorIntoView(editor));
        }
        return;
      case "blockMenu":
        openBlockMenu(editor);
        return;
    }
  };

  const buttons: (FormatAction | BlockAction | "closeMenu")[] = [...FORMAT_ACTIONS, ...BLOCK_ACTIONS, ...(menuShowing ? (["closeMenu"] as const) : [])];
  const active = Math.min(focusIndex, buttons.length - 1);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      editor.focus();
      return;
    }
    const next = nextToolbarIndex(active, event.key, buttons.length);
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    toolbarRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const button = (action: FormatAction | BlockAction | "closeMenu", index: number) => {
    const Icon = action === "closeMenu" ? X : ICONS[action];
    const isPressed = action === "closeMenu" ? undefined : pressed(action as FormatAction);
    return (
      <button
        key={action}
        type="button"
        className="qbbe-touch-button"
        data-action={action}
        aria-label={t(`units.e4.${action}`)}
        aria-pressed={isPressed}
        tabIndex={index === active ? 0 : -1}
        onFocus={() => setFocusIndex(index)}
        onClick={() => (action === "closeMenu" ? closeMenus(editor) : run(action))}
      >
        <Icon className="size-5" aria-hidden />
      </button>
    );
  };

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label={t("units.e4.toolbar")}
      className="qbbe-touch-toolbar"
      onKeyDown={onKeyDown}
      // Keeps the caret (and the phone's keyboard) in the text for any press
      // on the toolbar: also where a button was, since a touch outside the
      // slash menu closes it, and with it the Close button, mid-tap.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div role="group" aria-label={t("units.e4.textGroup")} className="qbbe-touch-group">
        {FORMAT_ACTIONS.map((action, index) => button(action, index))}
      </div>
      <div role="group" aria-label={t("units.e4.blockGroup")} className="qbbe-touch-group">
        {BLOCK_ACTIONS.map((action, index) => button(action, FORMAT_ACTIONS.length + index))}
        {menuShowing ? button("closeMenu", buttons.length - 1) : null}
      </div>
    </div>
  );
}

/**
 * Opens the editor's own block menu (move, duplicate, colour, turn into,
 * delete) for the block holding the caret, through the same Ctrl+/ shortcut
 * the editor listens for, so touch and keyboard share one menu.
 */
function openBlockMenu(editor: AnyBlockNoteEditor) {
  const target = editor.domElement;
  if (!target) return;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "/", code: "Slash", ctrlKey: true, bubbles: true, cancelable: true }));
}

function scrollCursorIntoView(editor: AnyBlockNoteEditor) {
  const id = editor.getTextCursorPosition().block.id;
  editor.domElement?.querySelector(`[data-node-type='blockOuter'][data-id='${CSS.escape(id)}']`)?.scrollIntoView({ block: "nearest" });
}

function LinkDialog({ editor, t, onClose }: { editor: AnyBlockNoteEditor; t: EditorT; onClose: () => void }) {
  const [address, setAddress] = React.useState(() => editor.getSelectedLinkUrl() ?? "");
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState(false);
  const addressId = React.useId();
  const textId = React.useId();
  const errorId = React.useId();
  const hasSelection = editor.getSelectedText().length > 0;
  // The caret inside an existing link, nothing selected: that link is edited.
  const [existing] = React.useState(() => {
    if (hasSelection) return undefined;
    const at = editor.prosemirrorState.selection.anchor;
    const link = editor.getLinkMarkAtPos(at);
    return link ? { text: link.text, at } : undefined;
  });

  // The dialog is modal, so the text cannot take focus until it has closed:
  // back to the text on the next frame, then the change.
  const finish = (after?: () => void) => {
    onClose();
    requestAnimationFrame(() => {
      editor.focus();
      after?.();
    });
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const href = safeLinkHref(address);
    if (!href) {
      setError(true);
      return;
    }
    const label = text.trim();
    finish(() => {
      if (existing) editor.editLink(href, label || existing.text, existing.at);
      else if (label) editor.createLink(href, label);
      else if (hasSelection) editor.createLink(href);
      else editor.createLink(href, href);
      announce(t("units.e4.linkDialog.added"));
    });
  };

  return (
    <Dialog open onClose={() => finish()} title={t("units.e4.linkDialog.title")}>
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <div>
          <Label htmlFor={addressId}>{t("units.e4.linkDialog.address")}</Label>
          <Input
            id={addressId}
            type="url"
            inputMode="url"
            autoComplete="url"
            value={address}
            autoFocus
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setAddress(event.target.value);
              setError(false);
            }}
          />
          {error ? (
            <p id={errorId} role="alert" className="mt-1 text-sm text-danger-fg">
              {t("units.e4.linkDialog.invalid")}
            </p>
          ) : null}
        </div>
        {hasSelection ? null : (
          <div>
            <Label htmlFor={textId}>{t("units.e4.linkDialog.text")}</Label>
            <Input id={textId} value={text} placeholder={existing?.text} onChange={(event) => setText(event.target.value)} />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => finish()}>
            {t("units.e4.linkDialog.cancel")}
          </Button>
          <Button type="submit">{t("units.e4.linkDialog.add")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
