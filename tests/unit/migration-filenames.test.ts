import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The deployment runbook promises this gate exists. Until now it did not.
 *
 * `supabase db push` applies migrations in filename order, so two files
 * sharing a version prefix have no defined order between them: whichever the
 * sort happens to put first wins, and it can differ between a developer's
 * machine and CI. That is the kind of drift which only appears once, in the
 * environment you least want it to.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const VERSIONED = /^(\d{14})_[a-z0-9_]+\.sql$/;

describe("migration filenames", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

  it("finds the migrations directory", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("names every migration <14-digit version>_<snake_case>.sql", () => {
    // Two files predate the timestamp convention and are ordered by their
    // 000N prefix; they are grandfathered rather than renamed, because
    // renaming an applied migration breaks every environment that has it.
    const legacy = /^\d{4}_[a-z0-9_]+\.sql$/;
    const malformed = files.filter((f) => !VERSIONED.test(f) && !legacy.test(f));
    expect(malformed).toEqual([]);
  });

  it("gives every migration a unique version prefix", () => {
    const seen = new Map<string, string[]>();
    for (const file of files) {
      const version = file.split("_")[0];
      seen.set(version, [...(seen.get(version) ?? []), file]);
    }
    const collisions = [...seen.entries()].filter(([, f]) => f.length > 1);
    expect(collisions).toEqual([]);
  });

  it("orders lexicographically the same way it orders chronologically", () => {
    // A version that sorts as text but not as a number would apply out of
    // order. Fixed-width prefixes make the two agree; this asserts they do.
    const versions = files.map((f) => f.split("_")[0]);
    const byText = [...versions].sort();
    const byNumber = [...versions].sort((a, b) => Number(a) - Number(b));
    expect(byText).toEqual(byNumber);
  });
});
