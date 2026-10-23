import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser downloads a feature's interface text only in the page's
 * language (PERF-004). A feature's catalogues.ts imports both languages for
 * server code; the browser build swaps it for catalogues.browser.ts
 * (next.config.ts), which loads each language on demand. These tests walk
 * the static imports from every "use client" file the way the browser build
 * resolves them, and fail if one reaches a feature's language file.
 */

const ROOT = path.resolve(__dirname, "../../..");
const files = (readdirSync(path.join(ROOT, "src"), { recursive: true }) as string[])
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .map((file) => path.join("src", file));

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  // As next.config.ts does for the browser.
  if (/[\\/]src[\\/]features[\\/]/.test(base) && base.endsWith(`${path.sep}catalogues`) && existsSync(`${base}.browser.ts`)) {
    return `${base}.browser.ts`;
  }
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx"), base]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  return null;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use server["']/.test(source)) continue;
    const pattern = /^\s*(import|export)\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
    for (const match of source.matchAll(pattern)) {
      const target = resolve(file, match[3] ?? match[4]);
      if (target) queue.push(target);
    }
  }
  return new Set([...seen].map((file) => path.relative(ROOT, file)));
}

const catalogueModules = files.filter((file) => /^src[\\/]features[\\/].*[\\/]catalogues\.ts$/.test(file));
/** The language files the catalogues gather. */
const languageFiles = new Set(
  catalogueModules.flatMap((file) =>
    [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/from\s+["'](\.[^"']+)["']/g)].map((match) =>
      path.relative(ROOT, resolve(path.join(ROOT, file), match[1])!),
    ),
  ),
);

describe("feature catalogues in the browser", () => {
  it("gathers the features' text in catalogues modules", () => {
    expect(catalogueModules.length).toBeGreaterThanOrEqual(26);
    expect(languageFiles.size).toBe(catalogueModules.length * 2);
  });

  it("gives each catalogues module a browser version that loads its languages on demand", () => {
    for (const file of catalogueModules) {
      const browser = file.replace(/\.ts$/, ".browser.ts");
      expect(existsSync(path.join(ROOT, browser)), browser).toBe(true);
      const source = readFileSync(path.join(ROOT, browser), "utf8");
      expect(source, browser).toMatch(/lazyCatalogues/);
      // Only import() of a language: a static import would bundle it.
      expect(source.match(/^\s*import\s+(?!type\b).*from\s+["']\.\//m), browser).toBeNull();
    }
  });

  it("no browser module reaches a feature's language file", () => {
    const clients = files.filter((file) => /^\s*["']use client["']/.test(readFileSync(path.join(ROOT, file), "utf8")));
    const offenders = new Set<string>();
    for (const client of clients) {
      for (const file of reachable(client)) if (languageFiles.has(file)) offenders.add(`${client} -> ${file}`);
    }
    expect([...offenders].sort()).toEqual([]);
  });
});
