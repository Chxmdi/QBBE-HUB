import type * as React from "react";
import type * as Y from "yjs";
import type { BlockNoteEditor } from "@blocknote/core";
import type { EditorT } from "@/features/editor/i18n";
import type { Locale } from "@/lib/i18n/config";
import type { EditorFileHandlers } from "@/features/editor/adapter/types";

/**
 * Wave 2 editor units (E1–E5, C1) plug into the editor through the slots in
 * this folder, so no two units edit the same file. Each unit owns exactly its
 * own `<id>-*.tsx` and `<id>-*.css`; `index.tsx` and `editor.tsx` already
 * call every slot and are not edited by units.
 */

// The editor's schema is built at runtime from the registry; units work with
// it through BlockNote's API, which is generic over that schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlockNoteEditor = BlockNoteEditor<any, any, any>;

/** What a unit can read when the editor is created. */
export interface EditorUnitCreateContext {
  t: EditorT;
  locale: Locale;
  /** The document's Yjs state (C1 syncs it). */
  doc: Y.Doc;
  /** The Yjs fragment name that holds the document. */
  fragment: string;
  files?: EditorFileHandlers;
  editable: boolean;
  /** The object's address, e.g. "/pages/<id>" (absent for task descriptions). */
  objectPath?: string;
}

/**
 * Options a unit adds to `useCreateBlockNote` (e.g. `pasteHandler`). They are
 * read once, when the editor is created: return the same object for the same
 * inputs (memoize). `collaboration` is merged into the editor's own
 * collaboration settings; every other key is passed through. A unit never sets
 * `schema`, `dictionary`, `domAttributes` or the collaboration `fragment`.
 */
export interface EditorUnitOptions {
  collaboration?: Record<string, unknown>;
  [key: string]: unknown;
}

/** What a unit's components receive once the editor exists. */
export interface EditorUnitProps {
  editor: AnyBlockNoteEditor;
  t: EditorT;
  locale: Locale;
  editable: boolean;
  /** The element around the editor and everything rendered with it. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  doc: Y.Doc;
  objectPath?: string;
}

/** Block specs a unit adds or replaces (by type key) in the editor schema. */
export type EditorUnitBlockSpecs = (t: EditorT, locale: Locale) => Record<string, unknown>;

export const NO_OPTIONS: EditorUnitOptions = Object.freeze({}) as EditorUnitOptions;
export const NO_SPECS: Record<string, unknown> = Object.freeze({}) as Record<string, unknown>;
