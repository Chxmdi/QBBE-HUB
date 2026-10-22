#!/usr/bin/env node
// Refuses destructive migrations that do not say when they became safe.
//
//   node scripts/ci/migration-contract.mjs   # exits 1 and lists offenders
//
// Deploys apply migrations while the previous image still serves, and a
// rollback runs the previous image against the migrated database. So schema
// changes ship in two steps (expand, then contract): first a release that
// stops using the old table or column, then a migration that removes it. A
// migration that drops a table or column, renames one, or changes a column's
// type is the contract step and must carry
//
//   -- contract: safe-after <sha>
//
// naming the already-released commit after which nothing reads the old shape.
// The reviewer checks that the commit is released; this check makes sure the
// question is asked. `npm test` runs it through tests/unit/migration-contract.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The newest migration when the rule began; it and older ones are exempt. */
export const CONTRACT_BASELINE = "20261115020000";

const MARKER = /^\s*--\s*contract:\s*safe-after\s+[0-9a-f]{7,40}\s*$/im;

const PATTERNS = [
  ["drop column", /\balter\s+table\b[^;]*?\bdrop\s+column\b/gi],
  ["drop table", /\bdrop\s+table\b/gi],
  ["rename", /\balter\s+table\b[^;]*?\brename\b/gi],
  ["alter column type", /\balter\s+column\s+[\w"]+\s+(?:set\s+data\s+)?type\b/gi],
];

// Comments and quoted strings (error messages, say) are not statements.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** The contract changes a migration makes, in the order they appear. */
export function contractChanges(sql) {
  const text = stripComments(sql);
  const found = [];
  for (const [label, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push({ label, at: match.index });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.label);
}

/** Migrations after the baseline that make contract changes without the marker. */
export function unmarkedContractMigrations(files) {
  return files
    .filter((file) => file.name.split("_")[0] > CONTRACT_BASELINE)
    .map((file) => ({ name: file.name, changes: contractChanges(file.sql), marked: MARKER.test(file.sql) }))
    .filter((file) => file.changes.length > 0 && !file.marked)
    .map(({ name, changes }) => ({ name, changes }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  const offenders = unmarkedContractMigrations(files);
  for (const file of offenders) {
    console.error(`${file.name}: ${file.changes.join(", ")} without "-- contract: safe-after <sha>"`);
  }
  process.exit(offenders.length > 0 ? 1 : 0);
}
