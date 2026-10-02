"use client";

import type * as React from "react";
import type { LayoutRenderContext, LayoutSettingsProps } from "./types";

/**
 * Wave 2 unit D3 (charts): how its layouts render, their settings and their
 * names. Only D3 edits this file (and d3.ids.ts). Until D3 lands it adds nothing.
 */

/** The body for one of this unit's layouts, or undefined when the layout is not this unit's. */
export const renderD3Layout: (ctx: LayoutRenderContext) => React.ReactNode | undefined = () => undefined;

/** Extra settings shown in the view settings panel for this unit's layouts. */
export const D3LayoutSettings: (props: LayoutSettingsProps) => React.ReactNode = () => null;

/** The display name of one of this unit's layouts, or null when it is not this unit's. */
export const d3LayoutLabel: (layout: string, t: LayoutSettingsProps["t"]) => string | null = () => null;
