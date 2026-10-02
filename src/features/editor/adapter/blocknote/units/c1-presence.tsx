"use client";

import "./c1-presence.css";
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
 * Wave 2 unit C1: presence and live co-editing. Only C1 edits this file and c1-presence.css.
 * Until C1 lands every slot is empty, so the editor behaves as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useC1Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const c1BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const C1InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const C1Outside: (props: EditorUnitProps) => React.ReactNode = () => null;
