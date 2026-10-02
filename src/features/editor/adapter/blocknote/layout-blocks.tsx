"use client";

import * as React from "react";
import { createExtension, insertOrUpdateBlockForSlashMenu, type Block, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { createReactBlockSpec, useEditorChange } from "@blocknote/react";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PmNode } from "prosemirror-model";
import { Select } from "@/components/ui/input";
import type { EditorT } from "@/features/editor/i18n";
import type { EditorBlock } from "@/features/editor/adapter/content";
import { headingAnchor, tocFromBlocks, type TocEntry } from "@/features/editor/adapter/toc";
import { columnFixes } from "@/features/editor/adapter/columns";
import { framed } from "./block-frame";

/**
 * Layout blocks (U5a): columns and a table of contents.
 *
 * `@blocknote/xl-multi-column` is not a dependency, so columns are a pair of
 * ordinary blocks: a `columnList` whose children are `column` blocks, each
 * holding the blocks it shows. The saved JSON (`columnList` > `column` with a
 * `width` prop) is the same shape the official package stores, so a later
 * switch to it needs no document migration. Layout is CSS grid on the column
 * list's child group (editor.css); the widths are grid spans.
 *
 * The table of contents reads the document's headings (levels 1 to 3) through
 * `tocFromBlocks` and links to `#block-<id>` anchors. The anchors come from a
 * ProseMirror decoration that gives every heading block its `id`, registered
 * as the block's extension, so BlockNote's own heading spec is left alone.
 */

export const columnWidths = [1, 2, 3] as const;
export type ColumnWidth = (typeof columnWidths)[number];
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

// The schema's block types are not visible here; the editor is used through
// the operations every BlockNote editor has, with loosely typed blocks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = BlockNoteEditor<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = Block<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPartialBlock = PartialBlock<any, any, any>;

/** Keeps typing inside a block's own control away from the editor's key handling. */
const isolateKeys = (event: React.KeyboardEvent) => event.stopPropagation();

const newColumn = (): AnyPartialBlock => ({ type: "column", children: [{ type: "paragraph" }] });

/** The first block with inline content inside a block, depth first. */
function firstTextBlock(block: AnyBlock | undefined): AnyBlock | undefined {
  if (!block) return undefined;
  if (Array.isArray(block.content)) return block;
  for (const child of block.children ?? []) {
    const found = firstTextBlock(child);
    if (found) return found;
  }
  return undefined;
}

function moveCursorInto(editor: AnyEditor, block: AnyBlock | undefined) {
  const target = firstTextBlock(block);
  if (target) editor.setTextCursorPosition(target, "start");
}

/**
 * The slash menu's insert, except that a block with nested blocks under it is
 * never turned into the new block: that would replace (and lose) the nested
 * blocks. The new block goes after it instead.
 */
function insertFromSlash(editor: AnyEditor, block: AnyPartialBlock): AnyBlock {
  const current = editor.getTextCursorPosition().block;
  if ((current.children ?? []).length > 0) return editor.insertBlocks([block], current, "after")[0];
  return insertOrUpdateBlockForSlashMenu(editor, block);
}

/** Inserts a two-column list at the cursor and puts the cursor in its first column. */
export function insertColumnList(editor: AnyEditor) {
  const inserted = insertFromSlash(editor, { type: "columnList", children: [newColumn(), newColumn()] } as AnyPartialBlock);
  moveCursorInto(editor, inserted);
}

/** The column holding a block, and its column list, when the block sits in one. */
function enclosingColumn(editor: AnyEditor, block: AnyBlock): { column: AnyBlock; list: AnyBlock } | null {
  let column: AnyBlock | undefined = block;
  while (column && column.type !== "column") column = editor.getParentBlock(column);
  if (!column) return null;
  const list = editor.getParentBlock(column);
  return list && list.type === "columnList" ? { column, list } : null;
}

/**
 * Adds a column beside the cursor's column (up to four). Outside a column
 * list, or when the list is full, it inserts a new two-column list instead.
 */
export function insertColumn(editor: AnyEditor) {
  const found = enclosingColumn(editor, editor.getTextCursorPosition().block);
  if (!found || found.list.children.length >= MAX_COLUMNS) {
    insertColumnList(editor);
    return;
  }
  const [created] = editor.insertBlocks([newColumn()], found.column, "after");
  moveCursorInto(editor, created);
}

/** Inserts a table of contents; writing continues in the text block below it. */
export function insertTableOfContents(editor: AnyEditor) {
  const inserted = insertFromSlash(editor, { type: "tableOfContents" } as AnyPartialBlock);
  const next = editor.getNextBlock(inserted);
  const target =
    next && Array.isArray(next.content) ? next : editor.insertBlocks([{ type: "paragraph" }], inserted, "after")[0];
  editor.setTextCursorPosition(target, "start");
}

// ---------------------------------------------------------------------------
// Column structure: kept by applying `columnFixes` after each local change,
// and by refusing the two keys that would pull a column apart.
// ---------------------------------------------------------------------------

function applyColumnFixes(editor: AnyEditor) {
  if (!editor.isEditable) return;
  const fixes = columnFixes(editor.document as unknown as EditorBlock[]);
  if (fixes.length === 0) return;
  editor.transact(() => {
    for (const fix of fixes) {
      if (fix.kind === "rewrap") editor.updateBlock(fix.id, { children: fix.children as AnyPartialBlock[] });
      else editor.replaceBlocks([fix.id], fix.blocks as AnyPartialBlock[]);
    }
  });
}

/** True when the cursor's block is a column, or sits directly in one. */
function cursorAtColumn(editor: AnyEditor): boolean {
  try {
    const block = editor.getTextCursorPosition().block;
    return block.type === "column" || editor.getParentBlock(block)?.type === "column";
  } catch {
    return false;
  }
}

export const columnStructureExtension = createExtension(({ editor }: { editor: AnyEditor }) => ({
  key: "qbbeColumnStructure",
  mount: ({ signal }: { signal: AbortSignal }) => {
    let scheduled = false;
    // Remote changes are fixed by the person who made them.
    const off = editor.onChange(() => {
      if (scheduled) return;
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        if (!signal.aborted) applyColumnFixes(editor);
      }, 0);
    }, false);
    signal.addEventListener("abort", () => off?.());
  },
  keyboardShortcuts: {
    // Outdenting a column's own top-level block would drop it out of the column.
    "Shift-Tab": () => cursorAtColumn(editor),
    // A whole column cannot be moved as a block; its contents can.
    "Mod-Shift-ArrowUp": () => editor.getTextCursorPosition().block.type === "column",
    "Mod-Shift-ArrowDown": () => editor.getTextCursorPosition().block.type === "column",
  },
}));

// ---------------------------------------------------------------------------
// Heading anchors: every heading block's content element gets id="block-<id>".
// ---------------------------------------------------------------------------

const headingAnchorsKey = new PluginKey<DecorationSet>("qbbeHeadingAnchors");

function headingAnchorDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "blockContainer") {
      const content = node.firstChild;
      const id = node.attrs.id;
      if (content && content.type.name === "heading" && typeof id === "string" && id) {
        decorations.push(Decoration.node(pos + 1, pos + 1 + content.nodeSize, { id: headingAnchor(id) }));
      }
      return true;
    }
    // Only block groups hold more blocks; content nodes (tables, text) are skipped.
    return node.type.name === "blockGroup";
  });
  return DecorationSet.create(doc, decorations);
}

const headingAnchorsPlugin = new Plugin<DecorationSet>({
  key: headingAnchorsKey,
  state: {
    init: (_config, state) => headingAnchorDecorations(state.doc),
    apply: (tr, previous) => (tr.docChanged ? headingAnchorDecorations(tr.doc) : previous),
  },
  props: {
    decorations: (state) => headingAnchorsKey.getState(state),
  },
});

export const headingAnchorsExtension = createExtension({
  key: "qbbeHeadingAnchors",
  prosemirrorPlugins: [headingAnchorsPlugin],
});

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

function TocList({ entries, onJump, t }: { entries: TocEntry[]; onJump: (event: React.MouseEvent<HTMLAnchorElement>, id: string) => void; t: EditorT }) {
  return (
    <ol className="qbbe-toc-list">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${headingAnchor(entry.id)}`}
            className="qbbe-toc-link"
            data-level={entry.level}
            onClick={(event) => onJump(event, entry.id)}
            onKeyDown={isolateKeys}
          >
            {entry.text}
          </a>
          {entry.children.length > 0 ? <TocList entries={entry.children} onJump={onJump} t={t} /> : null}
        </li>
      ))}
    </ol>
  );
}

function TableOfContentsBlock({ block, editor, t }: { block: AnyBlock; editor: AnyEditor; t: EditorT }) {
  const read = React.useCallback(() => tocFromBlocks(editor.document as unknown as EditorBlock[]), [editor]);
  const [entries, setEntries] = React.useState<TocEntry[]>(read);
  useEditorChange(() => setEntries(read()), editor);
  const navRef = React.useRef<HTMLElement>(null);

  // From the keyboard: with this block selected (the arrow keys stop on it),
  // Enter moves focus to its first link; Tab then walks the links, Enter
  // follows one, and Escape returns to the text.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const nav = navRef.current;
      const view = editor.prosemirrorView;
      if (!nav || !view) return;
      // A focused link is not editor focus to ProseMirror, so this comes first.
      if (event.key === "Escape" && nav.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        editor.setTextCursorPosition(block.id, "start");
        editor.focus();
        return;
      }
      if (!view.hasFocus()) return;
      if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target !== view.dom) return;
      let current: AnyBlock | undefined;
      try {
        current = editor.getTextCursorPosition().block;
      } catch {
        return;
      }
      if (current?.id !== block.id) return;
      const first = nav.querySelector<HTMLElement>("a[href]");
      if (!first) return;
      event.preventDefault();
      event.stopPropagation();
      first.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [editor, block.id]);

  const jump = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
      const anchor = headingAnchor(id);
      const target = document.getElementById(anchor);
      // Read-only, or the heading is gone: the browser's own #anchor jump.
      if (!target || !editor.isEditable) return;
      event.preventDefault();
      target.scrollIntoView({ block: "start" });
      window.history.replaceState(window.history.state, "", `#${anchor}`);
      try {
        editor.setTextCursorPosition(id, "start");
        editor.focus();
      } catch {
        // The heading changed under us; the scroll already happened.
      }
    },
    [editor],
  );

  return (
    <nav ref={navRef} className="qbbe-toc" aria-label={t("toc.label")} onKeyDown={isolateKeys}>
      <p className="qbbe-toc-title">{t("toc.label")}</p>
      {entries.length > 0 ? (
        <TocList entries={entries} onJump={jump} t={t} />
      ) : (
        <p className="qbbe-toc-empty">{t("toc.empty")}</p>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export function createLayoutBlocks(t: EditorT) {
  const columnList = createReactBlockSpec(
    { type: "columnList", propSchema: {}, content: "none" },
    {
      render: () => <span className="sr-only">{t("layout.columns")}</span>,
    },
  );

  const column = createReactBlockSpec(
    { type: "column", propSchema: { width: { default: 1 as number, values: columnWidths } }, content: "none" },
    {
      render: ({ block, editor }) => {
        const width = (columnWidths as readonly number[]).includes(block.props.width) ? (block.props.width as ColumnWidth) : 1;
        return (
          <div className="qbbe-column-head" onKeyDown={isolateKeys}>
            <span className="sr-only">{t("layout.column")}</span>
            {editor.isEditable ? (
              <Select
                aria-label={t("layout.width")}
                value={String(width)}
                className="qbbe-column-width h-7 w-auto text-caption"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if ((columnWidths as readonly number[]).includes(next)) editor.updateBlock(block, { props: { width: next as ColumnWidth } });
                }}
              >
                {columnWidths.map((value) => (
                  <option key={value} value={value}>
                    {t(`layout.width${value}`)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
        );
      },
    },
    [columnStructureExtension()],
  );

  const tableOfContents = createReactBlockSpec(
    { type: "tableOfContents", propSchema: {}, content: "none" },
    framed("tableOfContents", {
      render: ({ block, editor }) => <TableOfContentsBlock block={block as unknown as AnyBlock} editor={editor as unknown as AnyEditor} t={t} />,
    }),
    [headingAnchorsExtension],
  );

  return { columnList, column, tableOfContents };
}
