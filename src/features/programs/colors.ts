export const PROGRAM_COLORS = ["neutral", "blue", "green", "amber", "rose"] as const;
export type ProgramColor = (typeof PROGRAM_COLORS)[number];

/**
 * Programme colour is a wayfinding aid, not a status. It maps onto the existing
 * semantic tokens rather than raw hex so it follows the light/dark themes, and
 * it is always paired with the programme name in the interface — colour on its
 * own carries no meaning for a reader who cannot distinguish these hues.
 */
const ACCENTS: Record<ProgramColor, string> = {
  neutral: "var(--color-line)",
  blue: "var(--color-info)",
  green: "var(--color-success)",
  amber: "var(--color-warning)",
  rose: "var(--color-danger)",
};

export function isProgramColor(value: unknown): value is ProgramColor {
  return typeof value === "string" && (PROGRAM_COLORS as readonly string[]).includes(value);
}

/** Unknown or missing colours fall back to neutral rather than to nothing. */
export function programAccent(color: unknown): string {
  return ACCENTS[isProgramColor(color) ? color : "neutral"];
}
