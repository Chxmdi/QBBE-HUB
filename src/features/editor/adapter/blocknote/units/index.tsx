"use client";

import * as React from "react";
import type { EditorT } from "@/features/editor/i18n";
import type { Locale } from "@/lib/i18n/config";
import type { EditorUnitCreateContext, EditorUnitOptions, EditorUnitProps } from "./types";
import { E1InView, E1Outside, e1BlockSpecs, useE1Options } from "./e1-paste";
import { E2InView, E2Outside, e2BlockSpecs, useE2Options } from "./e2-history";
import { E3InView, E3Outside, e3BlockSpecs, useE3Options } from "./e3-blocks";
import { E4InView, E4Outside, e4BlockSpecs, useE4Options } from "./e4-mobile";
import { E5InView, E5Outside, e5BlockSpecs, useE5Options } from "./e5-performance";
import { C1InView, C1Outside, c1BlockSpecs, useC1Options } from "./c1-presence";

/**
 * Every wave 2 editor unit's slots, called in a fixed order. Units do not
 * edit this file: each fills in its own module.
 */

export type { EditorUnitCreateContext, EditorUnitOptions, EditorUnitProps } from "./types";

/** The units' editor options, merged in order (later units win on a clash). */
export function useEditorUnitOptions(ctx: EditorUnitCreateContext): EditorUnitOptions {
  const e1 = useE1Options(ctx);
  const e2 = useE2Options(ctx);
  const e3 = useE3Options(ctx);
  const e4 = useE4Options(ctx);
  const e5 = useE5Options(ctx);
  const c1 = useC1Options(ctx);
  return React.useMemo(() => mergeUnitOptions([e1, e2, e3, e4, e5, c1]), [e1, e2, e3, e4, e5, c1]);
}

export function mergeUnitOptions(parts: readonly EditorUnitOptions[]): EditorUnitOptions {
  const merged: EditorUnitOptions = {};
  for (const part of parts) {
    const { collaboration, ...rest } = part;
    Object.assign(merged, rest);
    if (collaboration) merged.collaboration = { ...(merged.collaboration ?? {}), ...collaboration };
  }
  return merged;
}

/** The units' block specs, merged in order over the editor's own. */
export function editorUnitBlockSpecs(t: EditorT, locale: Locale): Record<string, unknown> {
  return {
    ...e1BlockSpecs(t, locale),
    ...e2BlockSpecs(t, locale),
    ...e3BlockSpecs(t, locale),
    ...e4BlockSpecs(t, locale),
    ...e5BlockSpecs(t, locale),
    ...c1BlockSpecs(t, locale),
  };
}

export function EditorUnitsInView(props: EditorUnitProps) {
  return (
    <>
      <E1InView {...props} />
      <E2InView {...props} />
      <E3InView {...props} />
      <E4InView {...props} />
      <E5InView {...props} />
      <C1InView {...props} />
    </>
  );
}

export function EditorUnitsOutside(props: EditorUnitProps) {
  return (
    <>
      <E1Outside {...props} />
      <E2Outside {...props} />
      <E3Outside {...props} />
      <E4Outside {...props} />
      <E5Outside {...props} />
      <C1Outside {...props} />
    </>
  );
}
