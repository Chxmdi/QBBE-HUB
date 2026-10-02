"use client";

import "./e3-blocks.css";
import type * as React from "react";
import { useEditorT } from "@/features/editor/i18n/client";
import {
  NO_OPTIONS,
  NO_SPECS,
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E3: code and media blocks, block fallbacks. Only E3 edits this file and e3-blocks.css.
 * Until E3 lands every slot is empty, so the editor behaves as before.
 */

/** Options added to the editor when it is created (memoize what you return). */
export const useE3Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = () => NO_OPTIONS;

/** Block specs added or replaced by type key. */
export const e3BlockSpecs: EditorUnitBlockSpecs = () => NO_SPECS;

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E3InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const E3Outside: (props: EditorUnitProps) => React.ReactNode = () => null;

// --- Block fallback (used by ../block-frame.tsx for every custom block) ------

export interface BlockFallbackLabels {
  message: string;
  retry: string;
}

/** The fallback's words, in the reader's language. */
export function useBlockFallbackLabels(): BlockFallbackLabels {
  const t = useEditorT();
  return { message: t("units.e3.fallback.message"), retry: t("units.e3.fallback.retry") };
}

/** Shown instead of a block that failed to render; the rest of the page keeps working. */
export function BlockFallback({
  labels,
  onRetry,
}: {
  type: string;
  blockId: string;
  labels: BlockFallbackLabels;
  onRetry: () => void;
}) {
  return (
    <div role="note" contentEditable={false} className="flex w-full items-center justify-between gap-3 rounded-(--radius-sm) border border-line p-3 text-body-sm text-muted">
      <span>{labels.message}</span>
      <button type="button" onClick={onRetry} className="min-h-6 rounded-(--radius-sm) px-2 text-ink underline underline-offset-2 hover:bg-surface-soft">
        {labels.retry}
      </button>
    </div>
  );
}
