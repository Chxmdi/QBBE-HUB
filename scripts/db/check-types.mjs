// Fails when src/types/database.ts no longer matches the database schema.
//
//   npm run db:types:check    (after `supabase db reset`, as CI does)
//   npm run db:types          (--write: regenerate the file)
//
// The types are generated from the local database the migrations built, so
// a migration that changes a table, view or function without regenerating
// them (`npm run db:types`) fails here instead of drifting silently.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/types/database.ts";
const options = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 };
const args = ["gen", "types", "typescript", "--local"];

// The installed CLI (CI installs a pinned one with supabase/setup-cli); npx
// only on a developer machine that has none, so CI never downloads one.
function generate() {
  try {
    return execFileSync("supabase", args, options);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return execFileSync("npx", ["supabase", ...args], options);
  }
}
const generated = generate();
if (process.argv.includes("--write")) {
  writeFileSync(FILE, generated);
  console.log(`${FILE} regenerated from the local database. Commit it with the migration.`);
  process.exit(0);
}
const committed = readFileSync(FILE, "utf8");

if (generated !== committed) {
  const a = committed.split("\n");
  const b = generated.split("\n");
  const first = a.findIndex((line, i) => line !== b[i]);
  console.error(`${FILE} is out of date with the migrations (first difference at line ${first + 1}).`);
  console.error("Run `npm run db:types` against a freshly reset local database and commit the result.");
  process.exit(1);
}
console.log(`${FILE} matches the database schema.`);
