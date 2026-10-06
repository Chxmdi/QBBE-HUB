// Run the database/RLS suite against the local Supabase container.
//
//   npm run test:db
//
// The files run in one psql session, in the order below: qa-users.sql creates
// the fixture users every later file authenticates as, and rls.sql defines the
// tests.ok/tests.authenticate helpers they all call. Every file after those two
// opens its own transaction and rolls back, so a full run leaves the database
// exactly as it found it.
//
// Node rather than shell because npm runs scripts through cmd.exe on Windows,
// where `sh` is not on the PATH — the same reason seed-local.mjs is a script.
// The previous `sh -c '... | docker exec ...'` one-liner failed there with
// "'$DOCKER' is not recognized", so the suite could not be run on Windows at
// all and a local verification had to be assembled by hand.
//
// Every .sql file in supabase/tests runs, found by name: a new test file needs
// no edit here, so parallel work stops colliding on one shared list. Order
// still matters at the two ends, so FIRST and LAST pin it; everything between
// runs in name order, which is safe because each of those files opens its own
// transaction and rolls back. FIXTURES are data loaders run elsewhere
// (seed-local.mjs, perf.yml), never tests. A file that is none of these and
// would not run is impossible: the list below is every file in the folder.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const CONTAINER = "supabase_db_workspace";

const DIR = "supabase/tests";
// Must run first, in this order: qa-users.sql creates the fixture users and
// rls.sql defines the tests.* helpers every later file calls.
const FIRST = ["qa-users.sql", "rls.sql"];
// Last: it opens its own sessions, which only see committed rows, so it must
// not run inside a transaction an earlier file left open.
const LAST = ["concurrency.sql"];
// Data loaders, not tests: run by seed-local.mjs and the perf workflow.
const FIXTURES = ["perf-fixture.sql", "qa-scoped-grants.sql"];

const pinned = new Set([...FIRST, ...LAST, ...FIXTURES]);
const found = readdirSync(DIR).filter((name) => name.endsWith(".sql"));
for (const name of [...FIRST, ...LAST, ...FIXTURES]) {
  if (!found.includes(name)) {
    console.error(`${DIR}/${name} is named in test-db.mjs but does not exist.`);
    process.exit(1);
  }
}
const FILES = [
  ...FIRST,
  ...found.filter((name) => !pinned.has(name)).sort(),
  ...LAST,
].map((name) => `${DIR}/${name}`);

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

// One session for all of them, exactly as the previous `cat | psql` did: the
// helpers rls.sql defines have to still be there when the later files call them.
// concurrency.sql races two extra sessions through dblink. They connect over
// the container's own network address, where the password is checked (dblink
// refuses a connection whose password was never verified), so pass it in.
const raceHost = run(["exec", CONTAINER, "hostname", "-i"]).stdout.trim().split(/\s+/)[0];
if (!raceHost) {
  console.error("Could not read the database container's address for concurrency.sql.");
  process.exit(1);
}
const sql = [
  `select set_config('tests.race_host', '${raceHost}', false);`,
  ...FILES.map((file) => readFileSync(file, "utf8")),
].join("\n");
const result = run(
  ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  sql,
);

// psql sends `raise notice` to stderr, and tests.ok reports every assertion
// that way, so the PASS lines and any FAIL are both in there.
const output = `${result.stdout || ""}${result.stderr || ""}`;
process.stdout.write(output);

// Set the exit code rather than calling process.exit(): when stdout is a
// pipe (CI), exit() drops whatever has not been flushed yet, which cut the
// log short of the failing assertion.
if (result.status !== 0) {
  console.error(`\nDatabase suite failed (psql exit ${result.status}).`);
  process.exitCode = result.status ?? 1;
} else {
  const passed = (output.match(/PASS:/g) ?? []).length;
  console.log(`\n${passed} assertions passed across ${FILES.length} files.`);
}
