// W0-8 query engine spike: apply, seed or drop the spike schema on the LOCAL
// Supabase database only. It talks to the local container through
// `docker exec`, so it has no way to reach a hosted project.
//
//   node scripts/spikes/w0-8-query.mjs apply          # create schema wos_spike
//   node scripts/spikes/w0-8-query.mjs seed [tasks]   # default 5000 tasks
//   node scripts/spikes/w0-8-query.mjs drop           # remove it again
//
// Then run the spike suites (safety, RLS and the benchmark):
//
//   npx vitest run --config vitest.spike.config.ts
//
// Needs `npx supabase start` and `npm run db:seed` first (the seed supplies
// the organization, programs and QA users the spike data hangs off).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = "supabase_db_workspace";
const DIR = "supabase/spikes/w0-8-query";

const probe = spawnSync("docker", ["info"], { stdio: "ignore", shell: false });
const sudo = probe.status !== 0;
const run = (args, input) =>
  spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...args] : args, {
    input,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });

if (run(["inspect", CONTAINER]).status !== 0) {
  console.error(`The local database container (${CONTAINER}) is not running.`);
  console.error("Start it with: npx supabase start");
  process.exit(1);
}

function psql(file, vars = {}) {
  const args = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"];
  for (const [name, value] of Object.entries(vars)) args.push("-v", `${name}=${value}`);
  const result = run(args, readFileSync(`${DIR}/${file}`, "utf8"));
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  if (result.stdout.trim()) console.log(result.stdout.trim());
}

const [command, arg] = process.argv.slice(2);
if (command === "apply") {
  psql("schema.sql");
  console.log("Applied schema wos_spike to the local database.");
} else if (command === "seed") {
  const tasks = arg === undefined ? 5000 : Number(arg);
  if (!Number.isInteger(tasks) || tasks < 1 || tasks > 1_000_000) {
    console.error("Task count must be a whole number between 1 and 1,000,000.");
    process.exit(1);
  }
  psql("seed.sql", { tasks: String(tasks), projects: String(Math.max(20, Math.round(tasks / 25))) });
  console.log(`Seeded ${tasks} tasks.`);
} else if (command === "drop") {
  psql("drop.sql");
  console.log("Dropped schema wos_spike.");
} else {
  console.error("Usage: node scripts/spikes/w0-8-query.mjs apply | seed [tasks] | drop");
  process.exit(1);
}
