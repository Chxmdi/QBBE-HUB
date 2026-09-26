import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * UI-003: no component hard-codes a colour where a token exists. The week
 * view once pinned two hex values to patch one theme, and dark mode then had
 * to be maintained by hand at those call sites. Colours live in
 * src/design-system/styles/globals.css; components use the tokens.
 */

const ROOT = process.cwd();

// Places that cannot read CSS variables: the browser-chrome <meta> colours,
// and email HTML. Both are checked against the tokens below instead.
const ALLOWED = new Set([
  "src/app/layout.tsx",
  "src/features/notifications/services/email-templates.ts",
]);

function token(name: string, block: "light" | "dark" = "light"): string {
  const css = readFileSync(join(ROOT, "src/design-system/styles/globals.css"), "utf8");
  const scope = block === "light" ? css.slice(css.indexOf("@theme"), css.indexOf(".dark {")) : css.slice(css.indexOf(".dark {"));
  const match = scope.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1].toLowerCase();
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("design tokens", () => {
  it("no component, feature or page hard-codes a hex colour", () => {
    const offenders: string[] = [];
    for (const dir of ["src/components", "src/features", "src/app"]) {
      for (const path of files(join(ROOT, dir))) {
        const rel = relative(ROOT, path);
        if (ALLOWED.has(rel)) continue;
        const lines = readFileSync(path, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?:[0-9a-fA-F]{2})?\b(?![-\w])/.test(line)
            && /\[#|"#|'#|`#|:\s*#/.test(line)) {
            offenders.push(`${rel}:${index + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("email colours are the current brand tokens", async () => {
    const { EMAIL_COLORS } = await import("@/features/notifications/services/email-templates");
    for (const name of ["brand", "ink", "muted", "line", "canvas", "surface"] as const) {
      expect(EMAIL_COLORS[name], name).toBe(token(name));
    }
  });

  it("browser chrome matches the canvas in both themes", () => {
    const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8").toLowerCase();
    expect(layout).toContain(`"(prefers-color-scheme: light)", color: "${token("canvas")}"`);
    expect(layout).toContain(`"(prefers-color-scheme: dark)", color: "${token("canvas", "dark")}"`);
  });

  it("form controls come from the primitives, not bare elements (UI-004)", () => {
    const offenders: string[] = [];
    for (const dir of ["src/features", "src/app"]) {
      for (const path of files(join(ROOT, dir)).filter((file) => file.endsWith(".tsx"))) {
        const text = readFileSync(path, "utf8");
        if (/<select[\s>]/.test(text)) offenders.push(`${relative(ROOT, path)}: <select>`);
        if (/type="checkbox"/.test(text)) offenders.push(`${relative(ROOT, path)}: checkbox`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("stacking uses the layer tokens, not z-index literals", () => {
    const offenders: string[] = [];
    for (const dir of ["src/components", "src/features", "src/app"]) {
      for (const path of files(join(ROOT, dir))) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/\bz-(\d+|\[\d+\])(?![\w-])/g)) {
          offenders.push(`${relative(ROOT, path)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
