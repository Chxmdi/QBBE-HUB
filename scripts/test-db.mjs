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
// Adding a new test file means adding it to this list. There is no glob, on
// purpose: order matters and a file that silently stopped running would be
// worse than one that was never added.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CONTAINER = "supabase_db_workspace";

const FILES = [
  "supabase/tests/qa-users.sql",
  "supabase/tests/rls.sql",
  "supabase/tests/admin-mfa.sql",
  "supabase/tests/membership-lifecycle.sql",
  "supabase/tests/invitation-lifecycle.sql",
  "supabase/tests/invitation-organization.sql",
  "supabase/tests/communication-deactivation.sql",
  "supabase/tests/scoped-access-grants.sql",
  "supabase/tests/scoped-core-rls.sql",
  "supabase/tests/task-role-capabilities.sql",
  "supabase/tests/task-core-followups.sql",
  "supabase/tests/team-channel-access.sql",
  "supabase/tests/leftover-scoped-surfaces.sql",
  "supabase/tests/program-overview.sql",
  "supabase/tests/project-lifecycle.sql",
  "supabase/tests/document-scanning-meetings.sql",
  "supabase/tests/document-links.sql",
  "supabase/tests/work-planning.sql",
  "supabase/tests/events.sql",
  "supabase/tests/drive-integration-access.sql",
  "supabase/tests/email-suppression.sql",
  "supabase/tests/channel-history-access.sql",
  "supabase/tests/creator-visibility.sql",
  "supabase/tests/task-read-equivalence.sql",
  // Last: it opens its own sessions, which only see committed rows, so it
  // must not run inside a transaction an earlier file left open.
  "supabase/tests/concurrency.sql",
];

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

if (result.status !== 0) {
  console.error(`\nDatabase suite failed (psql exit ${result.status}).`);
  process.exit(result.status ?? 1);
}

const passed = (output.match(/PASS:/g) ?? []).length;
console.log(`\n${passed} assertions passed across ${FILES.length} files.`);
