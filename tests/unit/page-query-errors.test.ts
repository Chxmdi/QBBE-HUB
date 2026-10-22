import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A workspace page that reads `{ data }` from the ordinary Supabase client and
 * never looks at `error` renders a failed query as its empty state — "No
 * projects yet" during an outage — and the error boundary with Try again is
 * never reached (P0-UX-05, #100). Pages read through
 * `createSupabasePageClient`, which throws instead. A page may still use the
 * ordinary client if it handles `error` itself; this test holds that line.
 */

const ROOT = process.cwd();
const WORKSPACE = join(ROOT, "src/app/(workspace)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

describe("workspace pages surface query failures", () => {
  const all = pages(WORKSPACE);

  it("finds the pages", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it("never pairs the ordinary client with an unchecked { data } read", () => {
    const offenders = all
      .map((path) => ({ path, text: readFileSync(path, "utf8") }))
      .filter(({ text }) => text.includes("createSupabaseServerClient"))
      .filter(({ text }) => !/\.error\b|\berror\s*[,:}]|\berror\)/.test(text))
      .map(({ path }) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });
});

describe("page loaders outside src/app read through the page client", () => {
  // Loaders that a page calls directly. Each used the ordinary client and
  // read only `data`, so a failed read rendered as an empty list.
  const LOADERS = [
    "src/features/dashboard/services/portfolio.queries.ts",
    "src/features/crm/services/opportunity.queries.ts",
  ];
  it.each(LOADERS)("%s uses createSupabasePageClient", (path) => {
    expect(readFileSync(join(ROOT, path), "utf8")).toMatch(/createSupabasePageClient\(\)/);
  });
});
