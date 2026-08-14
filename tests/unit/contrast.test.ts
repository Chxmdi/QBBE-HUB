import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards WCAG 2.2 AA contrast for every colored-text token in both themes
 * (A11Y-001). This runs in CI without a browser, so a token edit that
 * would fail the Playwright accessibility matrix fails here first.
 */

const CSS = readFileSync(
  join(process.cwd(), "src/design-system/styles/globals.css"),
  "utf8",
);

/** Reads a custom property from a specific block of the stylesheet. */
function token(name: string, scope: "light" | "dark"): string {
  // The dark theme block starts at `.dark {`.
  const darkStart = CSS.indexOf(".dark {");
  const region =
    scope === "light" ? CSS.slice(0, darkStart) : CSS.slice(darkStart);
  const match = region.match(
    new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`),
  );
  if (!match) throw new Error(`token --${name} not found in ${scope} theme`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/\w\w/g)!
    .map((pair) => {
      const value = parseInt(pair, 16) / 255;
      return value <= 0.03928
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
    });
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

const FOREGROUNDS = [
  "color-brand-fg",
  "color-success-fg",
  "color-warning-fg",
  "color-danger-fg",
  "color-info-fg",
  "color-ink",
  "color-muted",
];

describe("colored text meets WCAG AA in both themes", () => {
  for (const scope of ["light", "dark"] as const) {
    const surfaces = [
      token("color-surface", scope),
      token("color-canvas", scope),
      token("color-surface-soft", scope),
    ];

    for (const fg of FOREGROUNDS) {
      it(`${fg} on ${scope} surfaces`, () => {
        const color = token(fg, scope);
        for (const surface of surfaces) {
          const ratio = contrastRatio(color, surface);
          expect(
            ratio,
            `${fg} (${color}) on ${surface} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      });
    }
  }
});

describe("white text on filled brand and status surfaces", () => {
  // Buttons put white text on these fills; they must clear AA as well.
  for (const fill of ["color-brand", "color-danger"]) {
    it(`white on --${fill}`, () => {
      const ratio = contrastRatio("#FFFFFF", token(fill, "light"));
      expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });
  }
});

describe("contrastRatio helper", () => {
  it("computes the known black-on-white maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#8F1538", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#8F1538"),
      5,
    );
  });
});
