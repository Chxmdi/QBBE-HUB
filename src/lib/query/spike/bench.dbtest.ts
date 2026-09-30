// W0-8 spike, benchmark: table-lens pages on the seeded data, as two viewers.
//
//   node scripts/spikes/w0-8-query.mjs seed [tasks]
//   SPIKE_REPORT=docs/design/spikes/W0-8-query-engine-plans.md \
//     npx vitest run --config vitest.spike.config.ts bench
//
// Targets (plan A7, P0-4): a page (first 100 rows, filtered, sorted, grouped)
// in under 1 second end to end, and count queries under 300 ms at p95.
// "End to end" here is the server side of a lens load: pool checkout, role
// switch, catalog load, compile, page + count + group counts, decode.

import { writeFileSync } from "node:fs";
import type { Client, Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compileLens } from "./compile";
import { adminClient, QA, runnerPool } from "./db-harness";
import { beginAsViewer, end, loadCatalog, runLens } from "./run";

const RUNS = Number(process.env.SPIKE_RUNS ?? 40);
const WARMUP = 5;

const SCENARIOS: Record<string, object> = {
  "A. Table lens: 3 filters in and/or, sort by date then title, group by select, 9 columns": {
    where: {
      and: [
        { property: "stage", operator: "is_any_of", value: ["todo", "doing", "review"] },
        {
          or: [
            { property: "due", operator: "is", value: { relative: "this_week" } },
            { property: "tags", operator: "has_any", value: ["finance", "grants"] },
          ],
        },
        { property: "approved", operator: "is", value: false },
      ],
    },
    sort: [{ property: "due" }, { property: "title" }],
    groupBy: { property: "priority" },
    select: ["stage", "priority", "tags", "due", "estimate", "reviewers", "approved", "project", "notes"],
  },
  "B. Relation: tasks of projects in a space, sort by updated": {
    where: { and: [{ property: "project", operator: "matches", value: { where: { and: [{ property: "space", operator: "is", value: "$SPACE" }, { property: "phase", operator: "is_not", value: "close" }] } } }] },
    sort: [{ property: "updated_at", direction: "desc" }],
    groupBy: { property: "stage" },
    select: ["stage", "due", "project"],
  },
  "C. Text search: title and notes contain, sort by number": {
    where: { and: [{ property: "title", operator: "contains", value: "grant" }, { property: "notes", operator: "not_contains", value: "legal" }] },
    sort: [{ property: "estimate", direction: "desc" }],
    select: ["notes", "estimate", "points"],
  },
  "D. No filter: all tasks, sort by title, group by stage": {
    sort: [{ property: "title" }],
    groupBy: { property: "stage" },
    select: ["stage", "priority", "due", "estimate", "project"],
  },
  "E. Me: my reviews or mine, due in the next 7 days or overdue": {
    where: {
      and: [
        { or: [{ property: "reviewers", operator: "contains", value: { relative: "me" } }, { property: "owner", operator: "contains", value: { relative: "me" } }] },
        { property: "due", operator: "on_or_before", value: { relative: "next_7_days" } },
        { property: "stage", operator: "is_not", value: "done" },
      ],
    },
    sort: [{ property: "due" }],
    groupBy: { property: "approved" },
    select: ["stage", "due", "reviewers", "approved"],
  },
};

let pool: Pool;
let admin: Client;
let space: string;

beforeAll(async () => {
  pool = await runnerPool();
  admin = adminClient();
  await admin.connect();
  space = (await admin.query("select id from public.program where name = 'Family First'")).rows[0].id;
});
afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const fmt = (n: number) => n.toFixed(1);

it("meets the budget and records plans", { timeout: 600_000 }, async () => {
  const size = (await admin.query("select count(*)::int as n from wos_spike.object o join wos_spike.object_type t on t.id = o.type_id where t.key = 'task'")).rows[0].n;
  const pv = (await admin.query("select count(*)::int as n from wos_spike.property_value")).rows[0].n;
  const version = (await admin.query("show server_version")).rows[0].server_version;
  const lines: string[] = [];
  const table: string[] = [
    "| Scenario | Viewer | Rows seen | Matches | Total p50 | Total p95 | Page p95 | Count p95 | Groups p95 |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  let worstTotal = 0;
  let worstCount = 0;

  for (const [name, raw] of Object.entries(SCENARIOS)) {
    const spec = JSON.parse(JSON.stringify({ version: 1, type: "task", ...raw }).replace("$SPACE", space));
    for (const [viewerName, viewer] of [["owner", QA.owner], ["lead", QA.lead]] as const) {
      const ctx = { viewerId: viewer, timeZone: "America/Toronto", now: new Date() };
      const t = { total: [] as number[], page: [] as number[], count: [] as number[], groups: [] as number[] };
      let matches = 0;
      for (let i = 0; i < WARMUP + RUNS; i++) {
        const r = await runLens(pool, spec, ctx);
        matches = r.total;
        if (i < WARMUP) continue;
        t.total.push(r.timings.totalMs);
        t.page.push(r.timings.pageMs);
        t.count.push(r.timings.countMs);
        t.groups.push(r.timings.groupsMs);
      }
      const seen = (await runLens(pool, { version: 1, type: "task", limit: 1 }, ctx)).total;
      worstTotal = Math.max(worstTotal, pct(t.total, 95));
      worstCount = Math.max(worstCount, pct(t.count, 95), pct(t.groups, 95));
      table.push(
        `| ${name.slice(0, 2)} | ${viewerName} | ${seen} | ${matches} | ${fmt(pct(t.total, 50))} | ${fmt(pct(t.total, 95))} | ${fmt(pct(t.page, 95))} | ${fmt(pct(t.count, 95))} | ${spec.groupBy ? fmt(pct(t.groups, 95)) : "–"} |`,
      );
    }

    // Plans, as the owner (sees every row, so the most work).
    const client = await beginAsViewer(pool, QA.owner);
    try {
      const compiled = compileLens(spec, await loadCatalog(client), { viewerId: QA.owner, timeZone: "America/Toronto", now: new Date() });
      lines.push(`## ${name}`, "", "```json", JSON.stringify(spec, null, 2), "```", "");
      for (const [label, q] of [["Page", compiled.page], ["Count", compiled.count], ["Group counts", compiled.groups]] as const) {
        if (!q) continue;
        const plan = await client.query(`explain (analyze, buffers, costs off, summary on) ${q.text}`, q.values);
        lines.push(`### ${label}`, "", "```", ...plan.rows.map((r) => r["QUERY PLAN"]), "```", "");
      }
    } finally {
      await end(client);
    }
  }

  const header = [
    "# W0-8 query engine spike: EXPLAIN plans",
    "",
    `Generated by \`src/lib/query/spike/bench.dbtest.ts\` on the local Supabase stack (PostgreSQL ${version}).`,
    `Data: ${size} tasks, ${pv} custom property values. ${RUNS} timed runs per row after ${WARMUP} warm-up runs. Times in ms.`,
    "",
    ...table,
    "",
    "Plans below are `EXPLAIN (ANALYZE, BUFFERS)` of each statement, run as the owner inside the viewer transaction, so RLS is part of every plan.",
    "",
  ];
  console.log(table.join("\n"));
  if (process.env.SPIKE_REPORT) writeFileSync(process.env.SPIKE_REPORT, [...header, ...lines].join("\n"));

  expect(worstTotal).toBeLessThan(1000);
  expect(worstCount).toBeLessThan(300);
});
