import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Deploy order (DATA-002). Migrations go live on the database the old image
 * is still serving, so they must run as late as possible: after the new image
 * is built (a failed build then changes nothing), straight before the swap,
 * and only after a fresh backup, which is the only way to undo a migration.
 */
const workflow = readFileSync(join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");

/** The text of one job, from its key to the next job's key. */
function job(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(name.length + 4).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + name.length + 4);
}

describe("deploy workflow order", () => {
  it("builds the image before it migrates", () => {
    expect(job("migrate")).toMatch(/\n {4}needs: \[evidence, build\]\n/);
    expect(job("build")).toMatch(/\n {4}needs: evidence\n/);
  });

  it("releases only after the migrations", () => {
    expect(job("release")).toMatch(/\n {4}needs: \[migrate, build\]\n/);
  });

  it("backs the database up right before applying migrations, and waits for it", () => {
    const migrate = job("migrate");
    const backup = migrate.indexOf("gh workflow run backup.yml");
    const apply = migrate.indexOf("- name: Apply migrations");
    expect(backup).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(backup);
    expect(migrate.slice(backup, apply)).toContain("gh run watch");
    expect(migrate.slice(backup, apply)).toContain("--exit-status");
    // Dispatching another workflow needs the actions permission.
    expect(migrate).toMatch(/permissions:\n\s+contents: read\n(\s+#.*\n)?\s+actions: write/);
  });
});
