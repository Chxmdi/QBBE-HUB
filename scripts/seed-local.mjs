// Take a freshly reset local Supabase database to the state the authenticated
// browser suites expect: the five QA fixture users, then the synthetic
// workspace content in supabase/seed/seed.sql.
//
//   npm run db:seed
//
// The seed cannot run during `supabase db reset` — config.toml keeps it
// disabled — because it needs an organization to exist, and only the bootstrap
// trigger creates one, when the first user signs up. qa-users.sql performs that
// first sign-up directly against auth.users, which is why the two files have to
// run in this order and why this is a script rather than a config flag.
//
// Node rather than shell so it runs from npm on Windows too, where `sh` is not
// on the PATH of the shell npm uses.
//
// Safe to run repeatedly. Talks only to the local container: it has no way to
// reach a hosted project.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = "supabase_db_workspace";

// Docker needs sudo on some Linux installs and never on Windows or macOS.
const probe = spawnSync("docker", ["info"], { stdio: "ignore", shell: false });
const sudo = probe.status !== 0;
const run = (args, input) =>
  spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...args] : args, {
    input,
    encoding: "utf8",
    shell: false,
  });

if (run(["inspect", CONTAINER]).status !== 0) {
  console.error(`The local database container (${CONTAINER}) is not running.`);
  console.error("Start it with: npx supabase start");
  process.exit(1);
}

function psql(file, label) {
  console.log(label);
  const result = run(
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
    readFileSync(file, "utf8"),
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  // psql sends `raise notice` to stderr, and the seed reports an already-seeded
  // workspace that way, so it is worth showing even on success.
  const notices = (result.stderr || "").trim();
  if (notices) console.log(notices);
}

psql("supabase/tests/qa-users.sql", "1/2 QA fixture users");
psql("supabase/seed/seed.sql", "2/2 Workspace seed data");

console.log("\nSeeded. Sign in as qa-owner@example.com / QaTest!2026");
