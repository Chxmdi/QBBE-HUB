import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The service role key bypasses row-level security. Every file that may use it
 * is listed, with its reason and the check that stands in for RLS, in
 * docs/adr/ADR-004-service-role-uses.md. This keeps that list and the code in
 * step: a new import fails here until it has a reviewed row in the ADR.
 */
const ADR = readFileSync(join(process.cwd(), "docs/adr/ADR-004-service-role-uses.md"), "utf8");
const listed = [...ADR.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]).sort();

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "tests" ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("service role uses", () => {
  it("lists every file that uses the service role client in ADR-004, and no other", () => {
    const using = files(join(process.cwd(), "src"))
      .filter((path) => /createSupabaseServiceClient/.test(readFileSync(path, "utf8")))
      .map((path) => relative(process.cwd(), path))
      .sort();
    expect(using).toEqual(listed);
  });
});
