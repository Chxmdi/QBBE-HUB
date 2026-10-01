// Loads the onboarding demo dataset into the local database, on top of the QA
// seed (`npm run db:seed`). Every file in scripts/demo/dataset/*.sql runs in
// name order through psql in the local container, each inside one
// transaction, so a failing file leaves nothing half-written.
//
//   node scripts/demo/dataset.mjs            # all files
//   node scripts/demo/dataset.mjs 30-money   # only files whose name contains this
//
// Files are idempotent: they use fixed UUIDs and `on conflict do nothing` or
// `where not exists`, so running twice changes nothing. Talks only to the local
// container; it has no way to reach a hosted project.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CONTAINER = "supabase_db_workspace";
const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];

const probe = spawnSync("docker", ["info"], { stdio: "ignore", shell: false });
const sudo = probe.status !== 0;
const run = (args, input) =>
  spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...args] : args, { input, encoding: "utf8", shell: false });

if (run(["inspect", CONTAINER]).status !== 0) {
  console.error(`The local database container (${CONTAINER}) is not running. Start it with: npx supabase start`);
  process.exit(1);
}

const dir = join(here, "dataset");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && (!only || f.includes(only)))
  .sort();
if (!files.length) {
  console.error(`No dataset files${only ? ` matching "${only}"` : ""} in ${dir}`);
  process.exit(1);
}

for (const file of files) {
  const sql = `begin;\n${readFileSync(join(dir, file), "utf8")}\ncommit;\n`;
  const result = run(
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    sql,
  );
  if (result.status !== 0) {
    console.error(`✗ ${file}\n${result.stderr || result.stdout}`);
    process.exit(result.status ?? 1);
  }
  const notices = (result.stderr || "").trim();
  console.log(`✓ ${file}${notices ? `\n  ${notices.replace(/\n/g, "\n  ")}` : ""}`);
}
console.log(`\nDemo dataset loaded (${files.length} file${files.length === 1 ? "" : "s"}).`);
