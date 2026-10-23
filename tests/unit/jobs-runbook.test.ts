import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOB_NAMES } from "@/features/jobs/services/handlers";

/**
 * docs/runbooks/jobs.md is where an operator looks up what a job does. Every
 * job the runner knows has a row in its schedule table, and the table names
 * no job the runner does not know (the two plain-SQL jobs aside).
 */
const SQL_ONLY = new Set(["purge-cron-history", "job-dispatch-watchdog"]);

function tableJobs(): string[] {
  const runbook = readFileSync("docs/runbooks/jobs.md", "utf8");
  const start = runbook.indexOf("## The schedule");
  const end = runbook.indexOf("\n## ", start + 1);
  const table = runbook.slice(start, end === -1 ? undefined : end);
  return [...table.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
}

describe("the jobs runbook", () => {
  it("lists every job the runner can run", () => {
    const listed = new Set(tableJobs());
    expect(JOB_NAMES.filter((name) => !listed.has(name)).sort()).toEqual([]);
  });

  it("lists no job that does not exist", () => {
    const known = new Set(JOB_NAMES);
    expect(tableJobs().filter((name) => !known.has(name) && !SQL_ONLY.has(name))).toEqual([]);
  });

  it("documents the job route as POST with the x-job-secret header", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    expect(agents).not.toMatch(/Bearer \$CRON_JOB_SECRET|CRON_SECRET\)|GET`\/`POST \/api\/jobs/);
    expect(agents).toMatch(/x-job-secret/);
  });
});
