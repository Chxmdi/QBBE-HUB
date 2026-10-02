"use client";

import "./e4-mobile.css";
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
 * Wave 2 unit E4: mobile editing. Only E4 edits this file and e4-mobile.css.
 * Until E4 lands every slot is empty, so the editor behaves as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE4Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e4BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E4InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const E4Outside: (props: EditorUnitProps) => React.ReactNode = () => null;
