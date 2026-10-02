"use client";

import type * as React from "react";
import type { LayoutRenderContext, LayoutSettingsProps } from "./types";

/**
 * Wave 2 unit D4 (timeline, gallery and feed layouts): how its layouts render, their settings and their
 * names. Only D4 edits this file (and d4.ids.ts). Until D4 lands it adds nothing.
 */

/** The body for one of this unit's layouts, or undefined when the layout is not this unit's. */
export const renderD4Layout: (ctx: LayoutRenderContext) => React.ReactNode | undefined = () => undefined;

/** Extra settings shown in the view settings panel for this unit's layouts. */
export const D4LayoutSettings: (props: LayoutSettingsProps) => React.ReactNode = () => null;

/** The display name of one of this unit's layouts, or null when it is not this unit's. */
export const d4LayoutLabel: (layout: string, t: LayoutSettingsProps["t"]) => string | null = () => null;
