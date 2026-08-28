import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { requiredText } from "@/lib/schema";

/**
 * The bug this guards against was invisible for the life of the project.
 *
 * Every form in the product drops empty values before submitting, so a field
 * left blank arrives missing rather than empty. `.min(1, "A task needs a
 * title.")` never fires on a missing value, so Zod answered "Required" and
 * thirty-seven carefully written sentences were dead code.
 */

describe("requiredText", () => {
  const schema = z.object({ title: requiredText("A task needs a title.", 300) });

  it("says the same thing however the value is absent", () => {
    for (const input of [{}, { title: "" }, { title: "   " }, { title: null }]) {
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("A task needs a title.");
      }
    }
  });

  it("trims what it accepts", () => {
    const result = schema.safeParse({ title: "  Write the report  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.title).toBe("Write the report");
  });

  it("enforces the maximum when one is given, and allows none", () => {
    expect(schema.safeParse({ title: "x".repeat(301) }).success).toBe(false);
    const unbounded = z.object({ when: requiredText("Pick a date.") });
    expect(unbounded.safeParse({ when: "x".repeat(5000) }).success).toBe(true);
    expect(unbounded.safeParse({}).success).toBe(false);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

describe("no schema goes back to the broken pattern", () => {
  it("has no bare z.string().min(1, ...) left in src", () => {
    // requiredText exists so this decision is made once. A new
    // `z.string().trim().min(1, "…")` is the old bug reintroduced: the message
    // reads fine in review and never reaches a person.
    const offenders = sourceFiles("src")
      .filter((path) => path !== join("src", "lib", "schema.ts"))
      .filter((path) =>
        // z.string(), then only zero-argument modifiers like .trim(), then
        // .min(1, …). Restricting the gap that way keeps a legitimate
        // z.array(z.string()).min(1, …) out of the results — that pattern has
        // the same trap, but a different fix, and a false positive here would
        // send somebody hunting for a bug that is not there.
        /z\s*\.string\(\)\s*(?:\.\w+\(\s*\)\s*)*\.min\(\s*1\s*,/s.test(
          readFileSync(path, "utf8"),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
