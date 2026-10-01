"use client";

import "@blocknote/ariakit/style.css";
import "./editor.css";
import * as React from "react";
import * as Y from "yjs";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
  type PartialBlock,
} from "@blocknote/core";
import { blocksToYDoc, withCollaboration } from "@blocknote/core/yjs";
import { en, fr } from "@blocknote/core/locales";
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import { Activity, Bookmark, FileText, Gavel, Link2, ListChecks, ListTodo, MessageSquareWarning, PanelTop, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/client";
import { useEditorT } from "@/features/editor/i18n/client";
import type { EditorT } from "@/features/editor/i18n";
import { CONTENT_VERSION, type EditorBlock, type EditorContent } from "@/features/editor/adapter/content";
import type { BlockEditorProps, EditorSemanticHandlers } from "@/features/editor/adapter/types";
import { createWorkspaceBlocks } from "./blocks";
import { createSemanticBlocks, HandlersBox } from "./semantic-blocks";
import { SuggestionLayer, TurnIntoTasksDialog, turnIntoPage } from "./progressive";
import { BlockHandle } from "./block-handle";
import {
  COLORS,
  MultiSelect,
  TEXT_TYPES,
  TURN_INTO,
  announce,
  colorBlocks,
  copyBlockLink,
  currentSelection,
  deleteBlocks,
  duplicateBlocks,
  hasColors,
  moveAndAnnounce,
  turnBlocksInto,
  type ColorKey,
} from "./multi-select";
import { Label, Select } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n/config";
import { rankByTitle } from "@/features/editor/adapter/slash";
import { base64ToBytes, bytesToBase64 } from "@/features/editor/adapter/state";

/**
 * BlockNote behind the adapter (M4b). Carries the W0-5 spike's accessibility
 * conditions (docs/design/spikes/W0-5-editor-accessibility.md):
 *   fixes 1–6    name and key hint, focus ring, contrast, target size,
 *                Alt+F10 into the toolbar, Escape then Tab to leave
 *   F2           Ctrl+/ opens a block menu (move, duplicate, delete, turn into,
 *                colour, copy link); the block handle and the selection bar
 *                (U4, block-handle.tsx and multi-select.tsx) share its actions
 *   F3, F6       missing names added and the invalid aria-expanded removed
 *   F5           an empty paragraph is kept after a final table
 *   F7           the emoji picker is left out
 *   F8           Quebec wording over BlockNote's France French
 */

function buildSchema(t: EditorT, locale: Locale, semantic: HandlersBox) {
  const { callout, bookmark, embed } = createWorkspaceBlocks(t);
  const s = createSemanticBlocks(t, locale, semantic);
  return BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      callout: callout(),
      bookmark: bookmark(),
      embed: embed(),
      task: s.task(),
      decision: s.decision(),
      person: s.person(),
      libraryFile: s.libraryFile(),
      pageLink: s.pageLink(),
      status: s.status(),
      query: s.query(),
    },
  });
}

type Schema = ReturnType<typeof buildSchema>;
type Editor = BlockNoteEditor<Schema["blockSchema"], Schema["inlineContentSchema"], Schema["styleSchema"]>;

/** The Yjs fragment that holds the document (the same name co-editing will sync). */
const FRAGMENT = "document-store";

/**
 * The document's Yjs state: the saved state when there is one, otherwise the
 * JSON content converted once (older saves, and task descriptions converted
 * from plain text). The conversion uses a headless editor with the same schema.
 */
function createDocument(schema: Schema, initialState: string | null | undefined, blocks: EditorBlock[]): Y.Doc {
  const doc = new Y.Doc();
  if (initialState) {
    try {
      Y.applyUpdate(doc, base64ToBytes(initialState));
      return doc;
    } catch {
      // A damaged state falls back to the JSON, which is always saved with it.
    }
  }
  if (blocks.length > 0) {
    const headless = BlockNoteEditor.create({ schema });
    const seeded = blocksToYDoc(headless, blocks as PartialBlock<Schema["blockSchema"]>[], FRAGMENT);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seeded));
  }
  return doc;
}

function quebecDictionary() {
  return {
    ...fr,
    slash_menu: {
      ...fr.slash_menu,
      divider: { ...fr.slash_menu.divider, title: "Séparateur", subtext: "Une ligne entre deux blocs", aliases: ["séparateur", "ligne", "hr"] },
    },
  };
}

function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * Names BlockNote leaves out, and the aria-expanded it sets on a textbox
 * (which ARIA does not allow; the highlighted option is still announced
 * through aria-activedescendant). Menus are portalled, so this watches the
 * whole document while the editor is mounted.
 *
 * Changes inside the editor's own DOM are made with ProseMirror's change
 * watcher paused: otherwise it treats the new attribute as an edit, redraws
 * the block without it, and the two loop forever.
 */
function useAccessibleNames(editor: Editor, t: EditorT) {
  React.useEffect(() => {
    const quietly = (change: () => void) => {
      const observer = (editor.prosemirrorView as unknown as { domObserver?: { stop(): void; start(): void } })
        .domObserver;
      observer?.stop();
      try {
        change();
      } finally {
        observer?.start();
      }
    };
    const patch = () => {
      const expanded = document.querySelectorAll<HTMLElement>(".qbbe-editor .bn-editor[aria-expanded]");
      const boxes = document.querySelectorAll<HTMLInputElement>(
        ".qbbe-editor [data-content-type='checkListItem'] input[type='checkbox']:not([aria-label])",
      );
      if (expanded.length || boxes.length) {
        quietly(() => {
          expanded.forEach((el) => el.removeAttribute("aria-expanded"));
          boxes.forEach((el) => el.setAttribute("aria-label", t("a11y.checkbox")));
        });
      }
      document
        .querySelectorAll<HTMLElement>(".bn-suggestion-menu[role='listbox']:not([aria-label]), .bn-container [role='listbox']:not([aria-label])")
        .forEach((el) => el.setAttribute("aria-label", t("a11y.slashList")));
      // The block-type select shows its value in text screen readers do not
      // get, so it always needs its own name.
      document
        .querySelectorAll<HTMLElement>(".bn-formatting-toolbar [role='combobox']:not([aria-label])")
        .forEach((el) => el.setAttribute("aria-label", t("a11y.blockType")));
      document
        .querySelectorAll<HTMLElement>(".bn-formatting-toolbar button, .bn-formatting-toolbar [role='combobox']")
        .forEach((el) => {
          if (el.getAttribute("aria-label") || el.textContent?.trim()) return;
          el.setAttribute("aria-label", el.getAttribute("data-tooltip") || el.title || t("a11y.toolbarControl"));
        });
    };
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        patch();
      });
    };
    patch();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded", "role"] });
    return () => observer.disconnect();
  }, [editor, t]);
}

/**
 * Keyboard conditions from the spike, on a capture listener so they run
 * before the editor sees the key:
 *   Alt+F10   into the formatting toolbar; Escape there returns to the text
 *   Escape    (no menu open) arms the next Tab to leave the editor
 *   Ctrl+/    opens the block menu
 */
function useKeyboardConditions(containerRef: React.RefObject<HTMLElement | null>, openBlockMenu: () => void) {
  React.useEffect(() => {
    let leaveArmed = false;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = containerRef.current;
      if (!root) return;
      const target = event.target as HTMLElement;
      const editorEl = root.querySelector<HTMLElement>(".bn-editor");
      const inEditor = Boolean(editorEl?.contains(target));
      const inToolbar = Boolean(target.closest?.(".bn-formatting-toolbar"));
      if (inEditor && event.key === "/" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        openBlockMenu();
        return;
      }
      if (event.key === "F10" && event.altKey && inEditor) {
        const first = document.querySelector<HTMLElement>(
          ".bn-formatting-toolbar button:not([disabled]), .bn-formatting-toolbar [role=combobox]",
        );
        if (first) {
          event.preventDefault();
          event.stopPropagation();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape" && inToolbar) {
        event.preventDefault();
        editorEl?.focus();
        return;
      }
      if (event.key === "Escape" && inEditor && !document.querySelector(".bn-suggestion-menu")) {
        leaveArmed = true;
        return;
      }
      // BlockNote itself blurs the editor on Escape, leaving focus on <body>
      // with the browser's Tab starting point still inside the document.
      if (event.key === "Tab" && leaveArmed && (root.contains(target) || target === document.body)) {
        event.preventDefault();
        event.stopPropagation();
        leaveArmed = false;
        focusOutside(root, event.shiftKey ? "before" : "after");
        return;
      }
      if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) leaveArmed = false;
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [containerRef, openBlockMenu]);
}

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex='-1'])";

/** Moves focus to the first focusable element after (or before) the editor. */
function focusOutside(root: HTMLElement, direction: "before" | "after") {
  const candidates = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !root.contains(el) && el.getClientRects().length > 0 && el.tabIndex >= 0,
  );
  const after = (el: HTMLElement) => Boolean(root.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const target = direction === "after" ? candidates.find(after) : candidates.filter((el) => !after(el)).pop();
  target?.focus();
}

function workspaceSlashItems(editor: Editor, t: EditorT): DefaultReactSuggestionItem[] {
  const group = t("slash.group");
  const item = (key: "callout" | "bookmark" | "embed", icon: React.JSX.Element): DefaultReactSuggestionItem => ({
    title: t(`slash.${key}.title`),
    subtext: t(`slash.${key}.subtext`),
    aliases: t(`slash.${key}.aliases`).split(","),
    group,
    icon,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: key } as PartialBlock<Schema["blockSchema"]>);
    },
  });
  return [
    item("callout", <MessageSquareWarning size={18} aria-hidden />),
    item("bookmark", <Bookmark size={18} aria-hidden />),
    item("embed", <PanelTop size={18} aria-hidden />),
  ];
}

type SemanticItem = "task" | "decision" | "person" | "status" | "query" | "libraryFile" | "pageLink";

function semanticSlashItems(editor: Editor, t: EditorT): DefaultReactSuggestionItem[] {
  const group = t("slash.group");
  const icons: Record<SemanticItem, React.JSX.Element> = {
    task: <ListChecks size={18} aria-hidden />,
    decision: <Gavel size={18} aria-hidden />,
    person: <UserRound size={18} aria-hidden />,
    status: <Activity size={18} aria-hidden />,
    query: <ListTodo size={18} aria-hidden />,
    libraryFile: <FileText size={18} aria-hidden />,
    pageLink: <Link2 size={18} aria-hidden />,
  };
  return (Object.keys(icons) as SemanticItem[]).map((key) => ({
    title: t(`semantic.items.${key}.title`),
    subtext: t(`semantic.items.${key}.subtext`),
    aliases: t(`semantic.items.${key}.aliases`).split(","),
    group,
    icon: icons[key],
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: key } as PartialBlock<Schema["blockSchema"]>);
    },
  }));
}

function BlockMenu({
  editor,
  t,
  onClose,
  selection,
  semantic,
  onTurnIntoTasks,
  objectPath,
  onCommentBlock,
}: {
  editor: Editor;
  t: EditorT;
  onClose: () => void;
  /** The blocks selected when the menu opened (the cursor's block if none). */
  selection: EditorBlock[];
  semantic?: EditorSemanticHandlers;
  onTurnIntoTasks: () => void;
  objectPath?: string;
  onCommentBlock?: (blockId: string) => void;
}) {
  const current = editor.getTextCursorPosition().block;
  // The same helpers as the block handle and the selection bar (U4), on the
  // whole selection when there is one.
  const ids = selection.length > 1 ? selection.map((block) => block.id!) : [current.id];
  const done = (text?: string) => {
    onClose();
    if (text) announce(text);
    requestAnimationFrame(() => editor.focus());
  };
  const canTurn = TEXT_TYPES.has(current.type);
  const canColor = hasColors(editor, current.type);
  const textColorId = React.useId();
  const backgroundColorId = React.useId();
  const colorOf = (prop: "textColor" | "backgroundColor") => {
    const value = (current.props as Record<string, unknown>)[prop];
    return typeof value === "string" ? value : "default";
  };
  return (
    <Dialog open onClose={() => done()} title={t("blockMenu.label")}>
      <div className="flex flex-col gap-1" role="group" aria-label={t("blockMenu.label")}>
        <Button variant="ghost" className="justify-start" onClick={() => { onClose(); moveAndAnnounce(editor, ids, "up", t); requestAnimationFrame(() => editor.focus()); }}>
          {t("blockMenu.moveUp")}
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => { onClose(); moveAndAnnounce(editor, ids, "down", t); requestAnimationFrame(() => editor.focus()); }}>
          {t("blockMenu.moveDown")}
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => { duplicateBlocks(editor, ids); done(); }}>
          {t("blockMenu.duplicate")}
        </Button>
        <Button variant="ghost" className="justify-start" onClick={() => { void copyBlockLink(objectPath, current.id, t); onClose(); requestAnimationFrame(() => editor.focus()); }}>
          {t("handle.copyLink")}
        </Button>
        {onCommentBlock ? (
          <Button variant="ghost" className="justify-start" onClick={() => { onClose(); onCommentBlock(current.id); }}>
            {t("handle.comment")}
          </Button>
        ) : null}
        {semantic && canTurn ? (
          <div className="my-1 border-t border-line pt-1">
            <Button variant="ghost" className="w-full justify-start" onClick={() => { onClose(); onTurnIntoTasks(); }}>
              {t("progressive.turnIntoTask")}
            </Button>
            {semantic.turnIntoPage ? (
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={async () => {
                  const ok = await turnIntoPage(editor as never, selection as never, semantic, t);
                  done(ok ? undefined : t("semantic.failed"));
                }}
              >
                {t("progressive.turnIntoPage")}
              </Button>
            ) : null}
          </div>
        ) : null}
        {canColor ? (
          <div className="my-1 grid grid-cols-2 gap-3 border-t border-line pt-2">
            {(["textColor", "backgroundColor"] as const).map((prop) => (
              <div key={prop}>
                <Label htmlFor={prop === "textColor" ? textColorId : backgroundColorId}>{t(prop === "textColor" ? "handle.textColor" : "handle.backgroundColor")}</Label>
                <Select
                  id={prop === "textColor" ? textColorId : backgroundColorId}
                  defaultValue={colorOf(prop)}
                  onChange={(event) => colorBlocks(editor, ids, { [prop]: event.target.value as ColorKey })}
                >
                  {COLORS.map((color) => (
                    <option key={color} value={color}>
                      {t(`colors.${color}`)}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
        ) : null}
        {canTurn ? (
          <div className="my-1 border-t border-line pt-1">
            {TURN_INTO.map(({ key, block }) => (
              <Button key={key} variant="ghost" className="w-full justify-start" onClick={() => { turnBlocksInto(editor, ids, block); done(); }}>
                {t("blockMenu.turnInto", { type: t(`types.${key}`) })}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="border-t border-line pt-1">
          <Button variant="ghost" className="w-full justify-start text-danger-fg" onClick={() => { deleteBlocks(editor, ids); done(t("blockMenu.deleted")); }}>
            {t("blockMenu.delete")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function toContent(blocks: unknown[]): EditorContent {
  return { version: CONTENT_VERSION, blocks: JSON.parse(JSON.stringify(blocks)) as EditorBlock[] };
}

export default function BlockNoteEditorImpl({
  initialContent,
  initialState,
  editable,
  onChange,
  files,
  semantic,
  taskSuggestions,
  hintId,
  label,
  objectPath,
  onCommentBlock,
}: BlockEditorProps) {
  const locale = useLocale();
  const t = useEditorT();
  const theme = useDocumentTheme();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<EditorBlock[]>([]);
  const [turningIntoTasks, setTurningIntoTasks] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  // Blocks read the latest handlers through a ref, so new handler objects do
  // not rebuild the schema (which would remount the editor).
  const [semanticBox] = React.useState(() => new HandlersBox(semantic ?? null));
  React.useEffect(() => {
    semanticBox.set(semantic ?? null);
  }, [semantic, semanticBox]);
  const schema = React.useMemo(() => buildSchema(t, locale, semanticBox), [t, locale, semanticBox]);
  // The first state only: the editor owns the document after it mounts.
  const [doc] = React.useState(() => createDocument(schema, initialState, initialContent.blocks));

  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary: locale === "fr-CA" ? quebecDictionary() : en,
      domAttributes: {
        editor: {
          "aria-label": label ?? t("label"),
          ...(hintId ? { "aria-describedby": hintId } : {}),
        },
      },
      uploadFile: files ? (file: File) => files.upload(file) : undefined,
      resolveFileUrl: files ? async (url: string) => (await files.resolve(url)) ?? "" : undefined,
      collaboration: {
        fragment: doc.getXmlFragment(FRAGMENT),
        user: { name: "", color: "var(--color-brand)" },
      },
    }),
    [schema, locale, doc],
  ) as unknown as Editor;

  useAccessibleNames(editor, t);
  const openBlockMenu = React.useCallback(() => {
    if (!editor.isEditable) return;
    const ids = currentSelection(editor);
    const picked = ids.length > 0 ? ids.map((id) => editor.getBlock(id)!).filter(Boolean) : (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]);
    setSelection(JSON.parse(JSON.stringify(picked)) as EditorBlock[]);
    setMenuOpen(true);
  }, [editor]);
  useKeyboardConditions(containerRef, openBlockMenu);

  const handleChange = React.useCallback(() => {
    const blocks = editor.document;
    // F5: keep a way out below a final table.
    const last = blocks[blocks.length - 1];
    if (editable && last && last.type === "table") {
      editor.insertBlocks([{ type: "paragraph" }], last, "after");
      return;
    }
    setVersion((n) => n + 1);
    onChange?.(toContent(blocks), bytesToBase64(Y.encodeStateAsUpdate(doc)));
  }, [editor, editable, onChange, doc]);

  const getItems = React.useCallback(
    async (query: string) =>
      rankByTitle(
        filterSuggestionItems(
          [
            ...getDefaultReactSlashMenuItems(editor).filter((item) => (item as { key?: string }).key !== "emoji"),
            ...workspaceSlashItems(editor, t),
            ...(semantic ? semanticSlashItems(editor, t) : []),
          ],
          query,
        ),
        query,
      ),
    [editor, t, semantic],
  );

  return (
    <div ref={containerRef} className="qbbe-editor relative">
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={editable}
        slashMenu={false}
        sideMenu={false}
        emojiPicker={false}
        onChange={handleChange}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
        {editable ? <BlockHandle t={t} objectPath={objectPath} onCommentBlock={onCommentBlock} /> : null}
      </BlockNoteView>
      <MultiSelect editor={editor} containerRef={containerRef} t={t} enabled={editable} />
      <p id="qbbe-editor-live" className="sr-only" aria-live="polite" />
      {menuOpen ? (
        <BlockMenu
          editor={editor}
          t={t}
          onClose={() => setMenuOpen(false)}
          selection={selection}
          semantic={semantic}
          onTurnIntoTasks={() => setTurningIntoTasks(true)}
          objectPath={objectPath}
          onCommentBlock={onCommentBlock}
        />
      ) : null}
      {turningIntoTasks && semantic ? (
        <TurnIntoTasksDialog
          editor={editor as never}
          blocks={selection as never}
          handlers={semantic}
          t={t}
          onClose={() => setTurningIntoTasks(false)}
        />
      ) : null}
      {semantic && taskSuggestions && editable ? (
        <SuggestionLayer
          editor={editor as never}
          containerRef={containerRef}
          options={taskSuggestions}
          handlers={semantic}
          t={t}
          version={version}
        />
      ) : null}
    </div>
  );
}
