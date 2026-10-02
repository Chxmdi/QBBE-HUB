/* Wave 2 unit E1: paste and Markdown shortcuts. Only E1 edits this file. */
"use client";

import "./e1-paste.css";
import * as React from "react";
import * as Y from "yjs";
import { createExtension, type PartialBlock } from "@blocknote/core";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { EditorT } from "@/features/editor/i18n";
import { planPaste, type PastedFile } from "@/features/editor/adapter/paste/plan";
import { afterScanCheck, fileBlockType, fileFits, MAX_SCAN_CHECKS, nextScanCheckMs, type UploadState } from "@/features/editor/adapter/paste/files";
import { pastedFileScanState, type PasteScanState } from "@/features/editor/services/paste-scan.commands";
import { CALLOUT_TYPED } from "@/features/editor/adapter/paste/shortcuts";
import {
  NO_SPECS,
  type AnyBlockNoteEditor,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E1: paste and Markdown shortcuts.
 *
 * Every paste is read by `planPaste` (adapter/paste), which turns rich text,
 * Markdown and spreadsheet cells into the editor's blocks without letting the
 * browser parse the pasted HTML, and refuses anything larger than the editor
 * can save. Pasted files go through the scanned upload, and their block says
 * whether it is uploading, waiting for its security check or failed (with a
 * way to retry). `>!` and a space at the start of a line makes a callout; the
 * other line shortcuts are the editor's own.
 */

/** "content": nothing was pasted; "file": a file over the size limit was left out. */
type PasteNotice = "content" | "file";

/** What one editor's paste handling shares with its components. */
class PasteController {
  readonly uploads = new Map<string, { file: File; state: UploadState }>();
  private readonly listeners = new Set<() => void>();
  notice: PasteNotice | null = null;
  view: { setStatus: (blockId: string, state: UploadState | null) => void } | null = null;
  t: EditorT | null = null;
  private stopped = false;

  constructor(readonly editor: AnyBlockNoteEditor) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  showNotice(notice: PasteNotice | null) {
    this.notice = notice;
    this.emit();
  }

  setStatus(blockId: string, file: File, state: UploadState | null) {
    if (state) this.uploads.set(blockId, { file, state });
    else this.uploads.delete(blockId);
    this.view?.setStatus(blockId, state);
  }

  start() {
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
  }

  /** Uploads a file into its block, then watches its scan until the file can be opened. */
  async upload(blockId: string, file: File) {
    const { editor } = this;
    const name = file.name || "file";
    this.setStatus(blockId, file, { state: "uploading", name });
    let ref: string;
    try {
      if (!editor.uploadFile) throw new Error("");
      const result = await editor.uploadFile(file, blockId);
      if (typeof result !== "string" || !result) throw new Error("");
      ref = result;
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : (this.t?.("files.uploadFailed") ?? "");
      if (editor.getBlock(blockId)) this.setStatus(blockId, file, { state: "failed", name, reason });
      return;
    }
    if (!editor.getBlock(blockId) || this.stopped) return;
    editor.updateBlock(blockId, { props: { url: ref } } as PartialBlock);
    this.setStatus(blockId, file, { state: "pending", name });
    for (let attempt = 0; attempt < MAX_SCAN_CHECKS && !this.stopped; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, nextScanCheckMs(attempt)));
      if (this.stopped || !editor.getBlock(blockId)) return;
      let scan: PasteScanState = "unknown";
      try {
        scan = await pastedFileScanState(ref);
      } catch {
        scan = "unknown";
      }
      const next = afterScanCheck(scan);
      if (next === "done") {
        this.setStatus(blockId, file, null);
        return;
      }
      if (next === "refused") {
        this.setStatus(blockId, file, { state: "refused", name });
        return;
      }
    }
  }

  retry(blockId: string) {
    const entry = this.uploads.get(blockId);
    const block = this.editor.getBlock(blockId);
    if (!entry || entry.state.state !== "failed" || !block) return;
    // A fresh block: BlockNote's file block swaps its "add file" button for a
    // loader on the first upload only, and throws when asked a second time.
    this.setStatus(blockId, entry.file, null);
    const fresh = this.editor.replaceBlocks([blockId], [{ type: block.type, props: { name: entry.file.name } } as PartialBlock]).insertedBlocks[0];
    if (fresh) void this.upload(fresh.id, entry.file);
  }
}

const controllers = new WeakMap<object, PasteController>();

function controllerFor(editor: AnyBlockNoteEditor): PasteController {
  let controller = controllers.get(editor);
  if (!controller) {
    controller = new PasteController(editor);
    controllers.set(editor, controller);
  }
  return controller;
}

/** The document's size as the save queue counts it: its content and its saved state. */
function documentChars(editor: AnyBlockNoteEditor, doc: Y.Doc): number {
  return JSON.stringify(editor.document).length + Math.ceil((Y.encodeStateAsUpdate(doc).length * 4) / 3);
}

/** Inserts file blocks for pasted files and starts their uploads. */
function pasteFiles(editor: AnyBlockNoteEditor, files: File[]) {
  const controller = controllerFor(editor);
  let reference = editor.getTextCursorPosition().block;
  for (const file of files) {
    if (!fileFits(file.size)) {
      controller.showNotice("file");
      continue;
    }
    const block = { type: fileBlockType(file.type), props: { name: file.name } } as PartialBlock;
    const empty = Array.isArray(reference.content) && reference.content.length === 0 && reference.type === "paragraph";
    const inserted = empty ? editor.updateBlock(reference, block) : editor.insertBlocks([block], reference, "after")[0];
    reference = inserted;
    void controller.upload(inserted.id, file);
  }
}

function createPasteHandler(doc: Y.Doc) {
  return ({ event, editor, defaultPasteHandler }: { event: ClipboardEvent; editor: AnyBlockNoteEditor; defaultPasteHandler: () => boolean | undefined }) => {
    const data = event.clipboardData;
    if (!data) return true;
    const files = Array.from(data.files ?? []);
    const plan = planPaste({
      types: Array.from(data.types ?? []),
      getData: (type) => data.getData(type),
      files: files.map((file): PastedFile => ({ name: file.name, type: file.type, size: file.size })),
      inCode: editor.transact((tr) => Boolean(tr.selection.$from.parent.type.spec.code && tr.selection.$to.parent.type.spec.code)),
      documentChars: documentChars(editor, doc),
    });
    const controller = controllerFor(editor);
    if (plan.kind !== "tooLarge") controller.showNotice(null);
    switch (plan.kind) {
      case "default":
        return defaultPasteHandler();
      case "internal":
        editor.pasteHTML(plan.html, true);
        return true;
      case "blocks":
        editor.pasteHTML(editor.blocksToFullHTML(plan.blocks as PartialBlock[]), true);
        return true;
      case "files":
        pasteFiles(editor, files);
        return true;
      case "tooLarge":
        controller.showNotice("content");
        return true;
      case "nothing":
        return true;
    }
  };
}

/** Options added to the editor when it is created: the paste handler. */
export function useE1Options(ctx: EditorUnitCreateContext): EditorUnitOptions {
  const { doc } = ctx;
  return React.useMemo(() => ({ pasteHandler: createPasteHandler(doc), extensions: [e1Extension()] }), [doc]);
}

/** Block specs added or replaced by type key. */
export const e1BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

// ---------------------------------------------------------------------------
// Upload notes inside file blocks, and the callout shortcut.

const uploadsKey = new PluginKey<{ states: Map<string, UploadState>; decorations: DecorationSet }>("qbbePasteUploads");

function uploadNote(state: UploadState, blockId: string, t: EditorT, onRetry: (blockId: string) => void): HTMLElement {
  const note = document.createElement("div");
  note.className = `qbbe-paste-note qbbe-paste-note-${state.state}`;
  note.contentEditable = "false";
  note.dataset.uploadState = state.state;
  note.setAttribute("role", state.state === "failed" || state.state === "refused" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent =
    state.state === "uploading"
      ? t("units.e1.file.uploading", { name: state.name })
      : state.state === "pending"
        ? t("units.e1.file.pending", { name: state.name })
        : state.state === "refused"
          ? t("units.e1.file.refused", { name: state.name })
          : t("units.e1.file.failed", { name: state.name, reason: state.reason });
  note.append(text);
  if (state.state === "failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "qbbe-paste-retry";
    retry.textContent = t("units.e1.file.retry");
    retry.addEventListener("mousedown", (event) => event.preventDefault());
    retry.addEventListener("click", () => onRetry(blockId));
    note.append(retry);
  }
  return note;
}

function uploadDecorations(state: EditorState["doc"], states: Map<string, UploadState>, t: EditorT | null, onRetry: (blockId: string) => void): DecorationSet {
  if (states.size === 0 || !t) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  state.descendants((node, pos) => {
    if (node.type.name === "blockContainer") {
      const status = states.get(node.attrs.id as string);
      const content = node.firstChild;
      if (status && content) {
        decorations.push(
          Decoration.widget(pos + 1 + content.nodeSize, () => uploadNote(status, node.attrs.id as string, t, onRetry), {
            key: `${node.attrs.id}:${status.state}:${status.state === "failed" ? status.reason : ""}`,
            side: 1,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        );
      }
      return true;
    }
    return node.type.name === "blockGroup" || node.type.name === "doc" || node.type.name === "column" || node.type.name === "columnList";
  });
  return DecorationSet.create(state, decorations);
}

/** `>!` and a space at the start of a paragraph turns it into a callout. */
function calloutShortcut(view: EditorView, from: number, to: number, text: string, editor: AnyBlockNoteEditor): boolean {
  if (text !== " " || from !== to) return false;
  const $from = view.state.doc.resolve(from);
  const parent = $from.parent;
  if (parent.type.name !== "paragraph" || parent.textBetween(0, $from.parentOffset) !== CALLOUT_TYPED) return false;
  if (!editor.schema.blockSchema.callout) return false;
  const start = from - $from.parentOffset;
  view.dispatch(view.state.tr.delete(start, from));
  const block = editor.getTextCursorPosition().block;
  editor.updateBlock(block, { type: "callout", props: { tone: "info" } } as unknown as PartialBlock);
  editor.setTextCursorPosition(block.id, "start");
  return true;
}

/**
 * The upload notes and the callout shortcut, given to the editor when it is
 * created. Registering them later (registerExtension) rebuilds the editor's
 * plugin views, and rebuilding the collaboration undo plugin's view destroys
 * its undo manager while the state keeps it: from then on nothing could be
 * undone. The translations are read from the controller when needed.
 */
const e1Extension = createExtension(({ editor }: { editor: AnyBlockNoteEditor }) =>
  createE1Plugins(editor, controllerFor(editor)),
);

function createE1Plugins(editor: AnyBlockNoteEditor, controller: PasteController) {
  const onRetry = (blockId: string) => controller.retry(blockId);
  const plugin = new Plugin<{ states: Map<string, UploadState>; decorations: DecorationSet }>({
    key: uploadsKey,
    state: {
      init: (_config, state) => {
        const states = new Map([...controller.uploads].map(([id, entry]) => [id, entry.state]));
        return { states, decorations: uploadDecorations(state.doc, states, controller.t, onRetry) };
      },
      apply: (tr, previous, _old, state) => {
        const change = tr.getMeta(uploadsKey) as { blockId: string; state: UploadState | null } | undefined;
        if (!change && !tr.docChanged) return previous;
        const states = new Map(previous.states);
        if (change) {
          if (change.state) states.set(change.blockId, change.state);
          else states.delete(change.blockId);
        }
        return { states, decorations: uploadDecorations(state.doc, states, controller.t, onRetry) };
      },
    },
    props: {
      decorations: (state) => uploadsKey.getState(state)?.decorations,
      handleTextInput: (view, from, to, text) => calloutShortcut(view, from, to, text, editor),
    },
  });
  return { key: "qbbePaste", prosemirrorPlugins: [plugin] } as const;
}

/** Connects the upload notes (given to the editor at creation) to this view while it is editable. */
export function E1InView({ editor, t, editable }: EditorUnitProps): React.ReactNode {
  React.useEffect(() => {
    if (!editable) return;
    const controller = controllerFor(editor);
    controller.t = t;
    controller.view = {
      setStatus: (blockId, state) => {
        const view = editor.prosemirrorView;
        if (view) view.dispatch(view.state.tr.setMeta(uploadsKey, { blockId, state }).setMeta("addToHistory", false));
      },
    };
    return () => {
      controller.view = null;
    };
  }, [editor, t, editable]);
  React.useEffect(() => {
    const controller = controllerFor(editor);
    controller.start();
    return () => controller.stop();
  }, [editor]);
  return null;
}

/** The "too large" notice after a paste that would not fit. */
export function E1Outside({ editor, t }: EditorUnitProps): React.ReactNode {
  const controller = controllerFor(editor);
  const notice = React.useSyncExternalStore(
    React.useCallback((listener: () => void) => controller.subscribe(listener), [controller]),
    () => controller.notice,
    () => null,
  );
  if (!notice) return null;
  return (
    <div role="alert" data-testid="editor-paste-too-large" className="qbbe-paste-too-large">
      <p>
        <strong>{notice === "content" ? t("units.e1.tooLarge.title") : t("units.e1.tooLarge.fileTitle")}</strong> {notice === "content" ? t("save.tooLarge") : t("files.tooLarge")}
      </p>
      <button
        type="button"
        className="qbbe-paste-dismiss"
        onClick={() => {
          controller.showNotice(null);
          editor.focus();
        }}
      >
        {t("units.e1.tooLarge.dismiss")}
      </button>
    </div>
  );
}
