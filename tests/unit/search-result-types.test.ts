import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEARCH_RESULT_TYPES,
  SEARCH_TYPE_LABELS,
  searchTypeLabel,
  searchTypeOrder,
} from "@/features/search/result-types";

/**
 * The point of these tests is drift, not logic.
 *
 * `global_search` is a SQL function and the two surfaces that render it are
 * TypeScript, so nothing but a test connects them. Add a branch to the
 * function without adding a label and a user sees the raw string "crm" in
 * their results — a small ugliness that nobody notices in review because the
 * two halves live in different languages, in different directories.
 *
 * So: read the migration, extract the result types it can emit, and insist the
 * label table covers exactly those.
 */

const MIGRATIONS = "supabase/migrations";

/**
 * The newest migration that redefines the function is the one in force. Found
 * by content rather than by name so that renaming a migration — which happens,
 * because the version recorded remotely is the one that counts — does not
 * quietly turn this file into a test of nothing.
 */
function currentSearchDefinition(): string {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      readFileSync(join(MIGRATIONS, f), "utf8").includes(
        "function public.global_search",
      ),
    );
  if (defining.length === 0) throw new Error("no migration defines global_search");
  return readFileSync(join(MIGRATIONS, defining[defining.length - 1]), "utf8");
}

function typesEmittedBySql(): string[] {
  const sql = currentSearchDefinition();
  // Every branch begins `select '<type>'` — the literal is the result_type.
  const matches = sql.matchAll(/^\s*select '([a-z_]+)'/gm);
  return Array.from(new Set(Array.from(matches, (m) => m[1]))).sort();
}

describe("search result vocabulary", () => {
  it("labels exactly the types the SQL function can return", () => {
    expect(typesEmittedBySql()).toEqual([...SEARCH_RESULT_TYPES].sort());
  });

  it("gives every type a singular and a plural", () => {
    for (const type of SEARCH_RESULT_TYPES) {
      const label = SEARCH_TYPE_LABELS[type];
      expect(label.singular.length).toBeGreaterThan(0);
      expect(label.plural.length).toBeGreaterThan(0);
    }
  });

  it("never shows a raw database word to a reader", () => {
    for (const type of SEARCH_RESULT_TYPES) {
      expect(searchTypeLabel(type)).not.toBe(type);
      expect(searchTypeLabel(type, "singular")).not.toBe(type);
    }
  });

  it("starts each label with a capital, because it is rendered as written", () => {
    for (const type of SEARCH_RESULT_TYPES) {
      expect(searchTypeLabel(type, "singular")[0]).toMatch(/[A-Z]/);
      expect(searchTypeLabel(type)[0]).toMatch(/[A-Z]/);
    }
  });

  it("falls back to the raw type rather than rendering nothing", () => {
    // A future migration could add a branch before anyone updates this file.
    // Showing "webhook" is poor; showing an empty row is worse.
    expect(searchTypeLabel("webhook")).toBe("webhook");
    expect(searchTypeOrder("webhook")).toBe(SEARCH_RESULT_TYPES.length);
  });

  it("orders types by the same priority the SQL round-robin uses", () => {
    const sql = currentSearchDefinition();
    const priority = sql.slice(sql.indexOf("order by r.rank_in_type"));
    const ordered = Array.from(
      priority.matchAll(/when '([a-z_]+)' then (\d+)/g),
      (m) => [m[1], Number(m[2])] as const,
    ).sort((a, b) => a[1] - b[1]);

    // The CASE names every type but the last, which falls to ELSE.
    expect(ordered.map(([type]) => type)).toEqual(
      SEARCH_RESULT_TYPES.slice(0, ordered.length),
    );
    expect(SEARCH_RESULT_TYPES.length).toBe(ordered.length + 1);
  });
});
