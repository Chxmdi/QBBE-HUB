import type { PagesKey } from "./i18n";

/**
 * Page covers are named presets drawn from the design tokens, never literal
 * colours, so they follow light and dark themes. Image covers arrive with the
 * editor's upload support (M4b) and are stored as `file:<document id>`.
 */
export const coverPresets = [
  { key: "brand", label: "covers.brand", className: "bg-brand" },
  { key: "accent", label: "covers.accent", className: "bg-accent" },
  { key: "success", label: "covers.success", className: "bg-success" },
  { key: "warning", label: "covers.warning", className: "bg-warning" },
  { key: "info", label: "covers.info", className: "bg-info" },
  { key: "soft", label: "covers.soft", className: "bg-surface-soft" },
] as const satisfies readonly { key: string; label: PagesKey; className: string }[];

export type CoverKey = (typeof coverPresets)[number]["key"];

export const coverKeys = coverPresets.map((preset) => preset.key) as [CoverKey, ...CoverKey[]];

export function coverClass(cover: string | null): string | null {
  return coverPresets.find((preset) => preset.key === cover)?.className ?? null;
}
