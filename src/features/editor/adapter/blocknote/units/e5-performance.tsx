"use client";

import "./e5-performance.css";
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
 * Wave 2 unit E5: speed on long pages. Only E5 edits this file and e5-performance.css.
 * Until E5 lands every slot is empty, so the editor behaves as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE5Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e5BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E5InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const E5Outside: (props: EditorUnitProps) => React.ReactNode = () => null;

// --- Lazy blocks (used by ../block-frame.tsx for every custom block) --------

/**
 * Wraps every custom block's view. Until E5 lands it renders the block at
 * once; E5 may hold back heavy blocks (views, embeds) until they are near the
 * screen, keeping their space so nothing jumps.
 */
export function LazyBlock({ children }: { type: string; blockId: string; children: React.ReactNode }) {
  return children;
}
