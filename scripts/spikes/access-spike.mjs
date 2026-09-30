// W0-7 access-check spike: apply, test, time or remove the prototype in
// supabase/spikes/w0-7-access against the LOCAL database container only.
//
//   node scripts/spikes/access-spike.mjs apply        # schema + dual write + backfill
//   node scripts/spikes/access-spike.mjs equivalence  # app.can vs today's rules
//   node scripts/spikes/access-spike.mjs equivalence resume  # from the changes on
//   node scripts/spikes/access-spike.mjs equivalence round2  # round 2's missing shards, then the report
//   node scripts/spikes/access-spike.mjs timing       # board query and refresh cost
//   node scripts/spikes/access-spike.mjs drop         # remove the prototype
//
// Expects a migrated, seeded local database with the #115 performance fixture
// loaded; docs/design/spikes/W0-7-access-check.md has the steps. Every file is
// piped into `docker exec ... psql` on the local container, so this script has
// no way to reach a hosted project. The spike is never a migration:
// `supabase db reset` removes it.
//
// `equivalence` COMMITS its fixture and changes to the local database (it
// runs the people in parallel sessions, which only see committed rows); reset
// the database afterwards. `apply` and `timing` leave nothing behind but the
// prototype itself.

import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const CONTAINER = "supabase_db_workspace";
const DIR = "supabase/spikes/w0-7-access";
const SHARDS = 4;

// Docker needs sudo on some Linux installs and never on Windows or macOS.
const probe = spawnSync("docker", ["info"], { stdio: "ignore", shell: false });
const sudo = probe.status !== 0;
const argv = (args) => (sudo ? ["sudo", ["docker", ...args]] : ["docker", args]);

if (spawnSync(...argv(["inspect", CONTAINER]), { stdio: "ignore" }).status !== 0) {
  console.error(`The local database container (${CONTAINER}) is not running.`);
  console.error("Start it with: npx supabase start");
  process.exit(1);
}

// Run SQL through psql in the local container; resolve with its output.
function psql(sql, variables = {}) {
  const vars = Object.entries(variables).flatMap(([name, value]) => ["-v", `${name}=${value}`]);
  const [cmd, args] = argv([
    "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-q", ...vars,
  ]);
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (status) => resolve({ status, output }));
    child.stdin.end(sql);
  });
}

const file = (name) => readFileSync(`${DIR}/${name}`, "utf8");

async function step(label, sql, variables) {
  const started = Date.now();
  const result = await psql(sql, variables);
  process.stdout.write(result.output);
  if (result.status !== 0) {
    console.error(`\n${label} failed (psql exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
  console.log(`-- ${label}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

// Run one round's shards in parallel. A shard already recorded in eq_run for
// this round is skipped, so a round interrupted part-way (a container restart
// takes the sessions with it) resumes with only the shards still missing.
async function round(name) {
  const started = Date.now();
  const done = await psql(
    `select coalesce(string_agg(shard::text, ','), '') from spike_access.eq_run where round = :'round';`,
    { round: name },
  );
  const finished = new Set(
    done.status === 0 ? done.output.split(/[\s,]+/).filter((s) => /^\d+$/.test(s)).map(Number) : [],
  );
  const pending = Array.from({ length: SHARDS }, (_, shard) => shard).filter((s) => !finished.has(s));
  if (finished.size > 0) console.log(`-- round ${name}: shards ${[...finished].join(", ")} already done`);
  const results = await Promise.all(
    pending.map((shard) =>
      psql(file("equivalence-compare.sql"), { round: name, shard, shards: SHARDS }),
    ),
  );
  for (const [index, result] of results.entries()) {
    const shard = pending[index];
    if (result.status !== 0) {
      process.stdout.write(result.output);
      console.error(`\nEquivalence round "${name}", shard ${shard} failed (psql exit ${result.status}).`);
      process.exit(result.status ?? 1);
    }
  }
  console.log(`-- round ${name}: ${((Date.now() - started) / 1000).toFixed(1)} s over ${SHARDS} sessions`);
}

const command = process.argv[2] ?? "apply";
switch (command) {
  case "apply": {
    const migrations = readdirSync(DIR).filter((name) => /^\d{14}_.*\.sql$/.test(name)).sort();
    // One transaction: a failure leaves nothing half-applied.
    await step("apply", ["begin;", ...migrations.map(file), "commit;"].join("\n"));
    break;
  }
  case "equivalence":
    // `equivalence resume` picks up after a completed round 1 (its fixture is
    // committed), so a failure in the changes does not cost the first round.
    // `equivalence round2` picks up after the changes, with only the round 2
    // shards still missing.
    if (!["resume", "round2"].includes(process.argv[3])) {
      await step("setup", file("equivalence-setup.sql"));
      await round("1 backfilled");
    }
    if (process.argv[3] !== "round2") {
      await step("changes", file("equivalence-changes.sql"));
    }
    await round("2 after changes");
    await step("report", file("equivalence-report.sql"));
    console.log("\nThe fixture and changes are committed: reset the local database now.");
    break;
  case "timing":
    await step("timing", file("timing.sql"));
    break;
  case "drop":
    await step("drop", "drop schema if exists spike_access cascade;");
    break;
  default:
    console.error(`Unknown command "${command}". Use: apply, equivalence, timing, drop`);
    process.exit(1);
}
