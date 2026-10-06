"use client";

import * as React from "react";
import { useEditorT } from "@/features/editor/i18n/client";
import { blockDefinition } from "@/features/editor/registry";
import { useLocale } from "@/lib/i18n/client";
import { createCodeBlock } from "./e3-code";
import { createMediaBlocks } from "./e3-media";
import {
  type EditorUnitBlockSpecs,
  type EditorUnitCreateContext,
  type EditorUnitOptions,
  type EditorUnitProps,
} from "./types";

/**
 * Wave 2 unit E3: code and media blocks, block fallbacks. Only E3 edits this
 * file and e3-blocks.css. The code, image, video, audio and file blocks keep
 * BlockNote's types and props (images add `alt`), so saved pages open as
 * before; their views are E3's (e3-code.tsx, e3-media.tsx) and framed, so a
 * broken one shows the fallback below instead of breaking the page.
 */

/**
 * Options added to the editor when it is created: what an empty quote, callout
 * or toggle says, so every text block tells the reader what to type
 * (BlockNote's dictionary already covers paragraphs, headings and lists).
 */
export const useE3Options: (ctx: EditorUnitCreateContext) => EditorUnitOptions = ({ t }) =>
  React.useMemo(
    () => ({
      placeholders: {
        quote: t("units.e3.placeholders.quote"),
        callout: t("units.e3.placeholders.callout"),
        toggleListItem: t("units.e3.placeholders.toggleListItem"),
      },
    }),
    [t],
  );

/** The block types E3 replaces in the editor schema. */
export const E3_BLOCK_TYPES = ["codeBlock", "image", "video", "audio", "file"] as const;

/** Block specs added or replaced by type key. */
export const e3BlockSpecs: EditorUnitBlockSpecs = (t) => ({ codeBlock: createCodeBlock(t), ...createMediaBlocks(t) });

/** Rendered inside BlockNoteView (menus, toolbars, controllers). */
export const E3InView: (props: EditorUnitProps) => React.ReactNode = () => null;

/** Rendered after the editor, inside its container (dialogs, panels, live regions). */
export const E3Outside: (props: EditorUnitProps) => React.ReactNode = () => null;

// --- Block fallback (used by ../block-frame.tsx for every custom block) ------

export interface BlockFallbackLabels {
  message: string;
  retry: string;
  /** The fallback's name for one block type, e.g. "Image block could not be shown". */
  label?: (type: string) => string;
}

/** The fallback's words, in the reader's language. */
export function useBlockFallbackLabels(): BlockFallbackLabels {
  const t = useEditorT();
  const locale = useLocale();
  return {
    message: t("units.e3.fallback.message"),
    retry: t("units.e3.fallback.retry"),
    label: (type) => {
      const definition = blockDefinition(type);
      return t("units.e3.fallback.label", { type: definition ? definition.label[locale === "fr-CA" ? "fr" : "en"] : type });
    },
  };
}

/** Shown instead of a block that failed to render; the rest of the page keeps working. */
export function BlockFallback({
  type,
  labels,
  onRetry,
}: {
  type: string;
  blockId: string;
  labels: BlockFallbackLabels;
  onRetry: () => void;
}) {
  return (
    <div
      role="note"
      aria-label={labels.label?.(type)}
      data-block-fallback={type}
      contentEditable={false}
      className="flex w-full items-center justify-between gap-3 rounded-(--radius-sm) border border-line p-3 text-body-sm text-muted"
    >
      <span>{labels.message}</span>
      <button type="button" onClick={onRetry} className="min-h-6 rounded-(--radius-sm) px-2 text-ink underline underline-offset-2 hover:bg-surface-soft">
        {labels.retry}
      </button>
    </div>
  );
}
