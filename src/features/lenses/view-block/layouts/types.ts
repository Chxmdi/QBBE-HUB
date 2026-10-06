import type { LensCatalog, CatalogProperty } from "@/lib/query/catalog";
import type { Locale } from "@/lib/i18n/config";
import type { LensT } from "@/features/lenses/i18n";
import type { ViewBlockRun } from "@/features/lenses/view-block/view-block.actions";
import type { ParsedViewBlockProps, ViewLayout } from "@/features/lenses/view-block/schema";

/** What a unit layout renders from: the block's props and its loaded rows. */
export interface LayoutRenderContext {
  layout: ViewLayout;
  props: ParsedViewBlockProps;
  data: Extract<ViewBlockRun, { ok: true }>;
  fields: CatalogProperty[];
  locale: Locale;
  t: LensT;
  /** The block's heading, for accessible names. */
  heading: string;
  /** The calendar-style anchor day (YYYY-MM-DD) and its setter. */
  anchor: string;
  onAnchor: (next: string) => void;
}

/** The settings panel's slot for a unit's layouts. */
export interface LayoutSettingsProps {
  /** The panel's id prefix, for label/input ids. */
  id: string;
  layout: ViewLayout;
  /** The unit-owned props currently in the draft (keys from the unit's propsShape). */
  value: Record<string, unknown>;
  /** Merges a patch into the unit-owned props. */
  onChange: (patch: Record<string, unknown>) => void;
  catalog: LensCatalog;
  /** The type the block shows. */
  type: string;
  t: LensT;
  locale: Locale;
}
