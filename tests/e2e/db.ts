import { spawnSync } from "node:child_process";

/**
 * A direct line to the local database for the browser suites.
 *
 * Shelling out to psql inside the container is the same route
 * scripts/seed-local.mjs takes, and for the same reason: it is the one path
 * that behaves identically on Windows, macOS and Linux. `npm run test:db` does
 * not run on Windows, where npm's shell has no `sh` on the PATH.
 *
 * This reaches the local container only. It has no way to address a hosted
 * project, and nothing here should ever be pointed at one.
 */

const CONTAINER = "supabase_db_workspace";

// Docker needs sudo on some Linux installs, and never on Windows or macOS.
const needsSudo = spawnSync("docker", ["info"], { stdio: "ignore", shell: false }).status !== 0;

export function sql(statement: string): string {
  const args = [
    "exec", "-i", CONTAINER,
    "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A",
  ];
  const result = spawnSync(
    needsSudo ? "sudo" : "docker",
    needsSudo ? ["docker", ...args] : args,
    { input: statement, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return (result.stdout || "").trim();
}
