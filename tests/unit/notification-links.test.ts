import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every notification the Hub creates carries a `link` that becomes the button
 * in its email. A link to a page that does not exist is a broken email, and
 * nothing at runtime would say so. This reads every `link:` the source writes
 * and checks the page it names exists under src/app/(workspace).
 */

const ROOT = process.cwd();
const APP = join(ROOT, "src/app/(workspace)");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** `link: \`/projects/${id}?tab=x\`` or `link: "/requests"` → "/projects/[id]", "/requests". */
function linkTemplates(): { file: string; route: string }[] {
  const found: { file: string; route: string }[] = [];
  for (const file of sourceFiles(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\blink:\s*(?:[^`"\n]*\?\s*)?[`"](\/[^`"\s?#]*)/g)) {
      const route = match[1].replace(/\$\{[^}]+\}/g, "[id]").replace(/\/$/, "") || "/";
      found.push({ file: relative(ROOT, file), route });
    }
  }
  return found;
}

function pageExists(route: string): boolean {
  const segments = route.split("/").filter(Boolean);
  return existsSync(join(APP, ...segments, "page.tsx"));
}

describe("notification deep links", () => {
  const templates = linkTemplates();

  it("finds the links the source writes", () => {
    // Guards the scan itself: if the pattern stopped matching, every check
    // below would pass vacuously.
    expect(templates.length).toBeGreaterThan(20);
    expect(templates.map((t) => t.route)).toEqual(
      expect.arrayContaining(["/my-work", "/projects/[id]", "/channels/[id]", "/requests"]),
    );
  });

  it("points every one at a page that exists", () => {
    const broken = templates.filter((t) => !pageExists(t.route));
    expect(broken).toEqual([]);
  });
});
