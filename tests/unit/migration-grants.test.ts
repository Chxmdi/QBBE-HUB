import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The API roles (anon, authenticated, service_role) get nothing on a new
 * object in schema public unless a migration grants it: Supabase's automatic
 * grants are off (supabase/config.toml, and revoked by
 * 20261119100000_explicit_api_grants.sql). A table without a grant fails in
 * the app as "permission denied", which shows up as a silent redirect to
 * /sign-in. So every migration added after the frozen baseline must grant
 * each table, view and sequence it creates in public (including the sequence
 * behind a serial column), and must revoke EXECUTE from public on each public
 * function or procedure it creates: Postgres lets every role execute a new
 * function, and no default privilege in this schema can stop that.
 */
const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const GENERATED = "20261119100000_explicit_api_grants.sql";

const name = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;

/** Objects created in schema public by this SQL that it never grants. */
function ungranted(sql: string): string[] {
  const text = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, "")
    .toLowerCase();
  const missing: string[] = [];
  const has = (pattern: string) => new RegExp(pattern).test(text);

  const created = (kind: string) =>
    [...text.matchAll(new RegExp(String.raw`create\s+(?:or\s+replace\s+)?${kind}\s+(?:if\s+not\s+exists\s+)?(?:([a-z_]+)\.)?"?([a-z_][a-z0-9_]*)"?`, "g"))]
      // Unqualified names land in public (the migration search_path); names in
      // other schemas (app., private.) are not reachable through the Data API.
      .filter((m) => m[1] === undefined || m[1] === "public")
      .map((m) => m[2]);

  for (const table of created("(?:unlogged\\s+)?table")) {
    if (!has(String.raw`grant\s[^;]*\son\s+(?:table\s+)?(?:[^;]*,\s*)?${name.replace("([a-z_][a-z0-9_]*)", table)}\b[^;]*\sto\s`))
      missing.push(`table ${table}`);
  }
  for (const view of created("(?:materialized\\s+)?view")) {
    if (!has(String.raw`grant\s[^;]*\son\s+(?:table\s+)?(?:[^;]*,\s*)?${name.replace("([a-z_][a-z0-9_]*)", view)}\b[^;]*\sto\s`))
      missing.push(`view ${view}`);
  }
  for (const sequence of created("sequence")) {
    if (!has(String.raw`grant\s[^;]*\son\s+sequence\s+(?:[^;]*,\s*)?${name.replace("([a-z_][a-z0-9_]*)", sequence)}\b`))
      missing.push(`sequence ${sequence}`);
  }
  // A serial column creates <table>_<column>_seq, which inserts need USAGE on.
  for (const m of text.matchAll(/create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(public)\.|(?![a-z_]+\.))"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/g)) {
    for (const col of m[3].matchAll(/(?:^|,)\s*"?([a-z_][a-z0-9_]*)"?\s+(?:big|small)?serial\b/g)) {
      const sequence = `${m[2]}_${col[1]}_seq`;
      if (!has(String.raw`grant\s[^;]*\son\s+sequence\s+(?:[^;]*,\s*)?(?:public\.)?${sequence}\b`))
        missing.push(`sequence ${sequence}`);
    }
  }
  for (const kind of ["function", "procedure"]) {
    for (const fn of created(kind)) {
      const revoke = String.raw`revoke\s[^;]*\son\s+${kind}\s+${name.replace("([a-z_][a-z0-9_]*)", fn)}\s*\([^;]*\sfrom\s+[^;]*\bpublic\b`;
      if (!has(revoke)) missing.push(`${kind} ${fn}`);
    }
  }
  return missing;
}

describe("migration grants", () => {
  it("flags a table, view, sequence or function created without grants", () => {
    expect(
      ungranted(`
        create table public.widget (id int);
        create view widget_summary as select 1;
        create sequence public.widget_seq;
        create or replace function public.widget_count() returns int language sql as $$ select 1 $$;
        create table app.private_widget (id int);
        create table public.gadget (id serial primary key, name text);
        grant select, insert on public.gadget to authenticated;
        create function public.anon_only() returns int language sql as $$ select 1 $$;
        revoke all on function public.anon_only() from anon;
        /* grant select on public.hidden to authenticated; */
        create table public.hidden (id int);
      `),
    ).toEqual([
      "table widget",
      "table hidden",
      "view widget_summary",
      "sequence widget_seq",
      "sequence gadget_id_seq",
      "function widget_count",
      "function anon_only",
    ]);
  });

  it("accepts objects whose access is stated", () => {
    expect(
      ungranted(`
        create table if not exists public.widget (id int);
        alter table public.widget enable row level security;
        grant select, insert on table public.widget to authenticated;
        grant select on public.widget to service_role;
        create view public.widget_summary as select 1;
        grant select on public.widget_summary, public.widget to authenticated;
        create or replace function public.widget_count() returns int language sql as $$ select 1 $$;
        revoke all on function public.widget_count() from public, anon;
        grant execute on function public.widget_count() to authenticated;
        create table public.gadget (id bigserial primary key);
        grant select, insert on public.gadget to authenticated;
        grant usage on sequence public.gadget_id_seq to authenticated;
      `),
    ).toEqual([]);
  });

  it("finds a grant for every public object in every migration after the baseline", () => {
    const baseline = new Set<string>(
      JSON.parse(readFileSync(join(process.cwd(), "tests", "unit", "migration-baseline.json"), "utf8")).files,
    );
    const problems = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && !baseline.has(f) && f !== GENERATED)
      .flatMap((f) => ungranted(readFileSync(join(MIGRATIONS, f), "utf8")).map((o) => `${f}: ${o}`));
    expect(problems).toEqual([]);
  });
});
