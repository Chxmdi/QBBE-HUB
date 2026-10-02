"use client";

import "./e2-history.css";
import type * as React from "react";
import {
  NO_OPTIONS,
  NO_SPECS,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E2: undo history and the keyboard shortcuts dialog. Only E2 edits this file and e2-history.css.
 * Until E2 lands every slot is empty, so the editor behaves as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE2Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e2BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E2InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const E2Outside: (props: EditorUnitProps) => React.ReactNode = () => null;
