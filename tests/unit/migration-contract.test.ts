import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_BASELINE,
  contractChanges,
  unmarkedContractMigrations,
} from "../../scripts/ci/migration-contract.mjs";

/**
 * Migrations go live while the previous release still serves traffic, and
 * a rolled-back image runs against the migrated database. So a migration may
 * only remove or reshape something the running code no longer uses. A file
 * that drops a table or column, renames one, or changes a column's type must
 * say which already-released commit stopped using it.
 */
describe("migration contract rule", () => {
  it("finds drops, renames and type changes, ignoring comments", () => {
    const sql = `
      -- drop column in a comment does not count
      /* nor alter table x rename to y */
      alter table public.a drop column b;
      ALTER TABLE ONLY public.a DROP COLUMN IF EXISTS c;
      drop table if exists public.old_thing;
      alter table public.a rename column d to e;
      alter table public.a rename to f;
      alter table public.a alter column g type bigint;
      alter table public.a alter column h set data type text;
      alter table public.a add column i int;
      drop function if exists public.fn();
      drop policy p on public.a;
      do $$ begin raise exception 'drop table first'; end $$;
    `;
    expect(contractChanges(sql)).toEqual([
      "drop column",
      "drop column",
      "drop table",
      "rename",
      "rename",
      "alter column type",
      "alter column type",
    ]);
  });

  it("accepts a file that names the released commit it is safe after", () => {
    const files = [
      { name: "20991231000000_contract.sql", sql: "-- contract: safe-after 1a2b3c4d\nalter table a drop column b;" },
      { name: "20991231010000_unmarked.sql", sql: "alter table a drop column b;" },
      { name: "20991231020000_bad_marker.sql", sql: "-- contract: safe-after later\nalter table a drop column b;" },
      { name: "20991231030000_additive.sql", sql: "alter table a add column b int;" },
    ];
    expect(unmarkedContractMigrations(files).map((f: { name: string }) => f.name)).toEqual([
      "20991231010000_unmarked.sql",
      "20991231020000_bad_marker.sql",
    ]);
  });

  it("grandfathers migrations already applied when the rule began", () => {
    const old = { name: `${CONTRACT_BASELINE}_old.sql`, sql: "alter table a drop column b;" };
    expect(unmarkedContractMigrations([old])).toEqual([]);
  });

  it("holds for every migration in the repository", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
    expect(unmarkedContractMigrations(files).map((f: { name: string; changes: string[] }) => `${f.name}: ${f.changes.join(", ")}`)).toEqual([]);
  });
});
