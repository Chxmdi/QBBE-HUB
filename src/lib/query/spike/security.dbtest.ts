// W0-8 spike, database suite: injection end to end, RLS, and what the runner
// role can and cannot do. Needs the local stack with the spike applied and
// seeded: node scripts/spikes/w0-8-query.mjs apply && ... seed

import type { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueryError } from "./compile";
import { adminClient, QA, runnerPool } from "./db-harness";
import { beginAsViewer, end, runLens } from "./run";
import { PAYLOADS } from "./fixtures";

let pool: Pool;
let admin: Client;
const ctxFor = (viewerId: string) => ({ viewerId, timeZone: "America/Toronto", now: new Date() });
const lens = (viewerId: string, spec: object) => runLens(pool, { version: 1, type: "task", ...spec }, ctxFor(viewerId));
const one = async <T,>(sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows[0] as T;

let familyFirst: string;
let taskType: string;

beforeAll(async () => {
  pool = await runnerPool();
  admin = adminClient();
  await admin.connect();
  familyFirst = (await one<{ id: string }>("select id from public.program where name = 'Family First'")).id;
  taskType = (await one<{ id: string }>("select id from wos_spike.object_type where key = 'task'")).id;
});

afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

async function tableCounts() {
  return one<Record<string, string>>(
    `select (select count(*) from wos_spike.object) as objects,
            (select count(*) from wos_spike.property_value) as property_values,
            (select count(*) from wos_spike.object_relation) as relations,
            (select count(*) from wos_spike.property_definition) as definitions`,
  );
}

describe("injection, end to end against the database", () => {
  it("binds payloads as plain values and changes nothing", async () => {
    const before = await tableCounts();
    for (const payload of PAYLOADS) {
      for (const [property, operator] of [
        ["notes", "equals"],
        ["notes", "contains"],
        ["title", "starts_with"],
        ["title", "not_equals"],
      ]) {
        if (payload.includes("\u0000")) {
          await expect(lens(QA.owner, { where: { and: [{ property, operator, value: payload }] } })).rejects.toBeInstanceOf(QueryError);
          continue;
        }
        const result = await lens(QA.owner, {
          where: { and: [{ property, operator, value: payload }] },
          select: ["notes"],
        });
        // Nothing in the data contains these strings, so a filter that
        // matches anything but "not equals" would mean the value was not bound.
        if (operator === "not_equals") expect(result.total).toBeGreaterThan(4000);
        else expect(result.total).toBe(0);
      }
      if (payload.includes("\u0000")) continue;
      const related = await lens(QA.owner, {
        where: { and: [{ property: "project", operator: "matches", value: { where: { and: [{ property: "title", operator: "equals", value: payload }] } } }] },
      });
      expect(related.total).toBe(0);
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("treats LIKE wildcards in a value literally", async () => {
    expect((await lens(QA.owner, { where: { and: [{ property: "notes", operator: "contains", value: "%" }] } })).total).toBe(0);
    expect((await lens(QA.owner, { where: { and: [{ property: "title", operator: "contains", value: "_" }] } })).total).toBe(0);
    expect((await lens(QA.owner, { where: { and: [{ property: "title", operator: "contains", value: "budget" }] } })).total).toBeGreaterThan(0);
  });

  it("rejects payloads in names before any SQL runs", async () => {
    for (const payload of PAYLOADS) {
      await expect(lens(QA.owner, { sort: [{ property: payload }] })).rejects.toBeInstanceOf(QueryError);
      await expect(lens(QA.owner, { groupBy: { property: payload } })).rejects.toBeInstanceOf(QueryError);
      await expect(lens(QA.owner, { where: { and: [{ property: payload, operator: "equals", value: "x" }] } })).rejects.toBeInstanceOf(QueryError);
      await expect(lens(QA.owner, { where: { and: [{ property: "notes", operator: payload, value: "x" }] } })).rejects.toBeInstanceOf(QueryError);
    }
  });
});

describe("the runner role", () => {
  it("cannot read anything as itself", async () => {
    const client = await pool.connect();
    try {
      await expect(client.query("select 1 from wos_spike.object limit 1")).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });

  it("cannot become service_role or postgres", async () => {
    const client = await pool.connect();
    try {
      await expect(client.query("set role service_role")).rejects.toThrow(/permission denied/);
      await expect(client.query("set role postgres")).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });

  it("cannot write inside a lens transaction", async () => {
    const client = await beginAsViewer(pool, QA.owner);
    try {
      await expect(client.query("update wos_spike.object set title = 'x' where false")).rejects.toThrow(/read-only transaction/);
    } finally {
      await end(client);
    }
  });
});

describe("RLS: a viewer only ever sees rows the policies allow", () => {
  async function expectedIds(viewer: string): Promise<Set<string>> {
    // Computed as admin from the fixture's known access, independently of the policy code.
    const rows = await admin.query<{ id: string }>(
      `select o.id from wos_spike.object o
       where o.type_id = $1 and o.archived_at is null
         and ($2 = 'owner' or o.owner_id = $3 or ($2 = 'lead' and o.space_id = $4))`,
      [taskType, viewer === QA.owner ? "owner" : viewer === QA.lead ? "lead" : "other", viewer, familyFirst],
    );
    return new Set(rows.rows.map((r) => r.id));
  }

  async function allIds(viewer: string, spec: object = {}): Promise<{ ids: Set<string>; total: number }> {
    const ids = new Set<string>();
    let total = 0;
    for (let offset = 0; offset <= 10_000; offset += 200) {
      const page = await lens(viewer, { ...spec, limit: 200, offset, sort: [{ property: "title" }] });
      total = page.total;
      page.rows.forEach((r) => ids.add(r.id));
      if (page.rows.length < 200) break;
    }
    return { ids, total };
  }

  it("outsider: a non-member cannot even resolve the type", async () => {
    await expect(lens(QA.outsider, {})).rejects.toMatchObject({ code: "unknown_type" });
  });

  for (const [name, viewer] of Object.entries(QA).filter(([name]) => name !== "outsider")) {
    it(`${name}: rows and count match what the policy allows`, async () => {
      const expected = await expectedIds(viewer);
      const { ids, total } = await allIds(viewer);
      expect(total).toBe(expected.size);
      expect(ids).toEqual(expected);
    });
  }

  it("filters and group counts stay inside what the viewer can see", async () => {
    const spec = { where: { and: [{ property: "approved", operator: "is", value: true }] }, groupBy: { property: "stage" } };
    const lead = await lens(QA.lead, spec);
    const owner = await lens(QA.owner, spec);
    const visible = await expectedIds(QA.lead);
    const approvedVisible = (
      await admin.query<{ object_id: string }>(
        "select v.object_id from wos_spike.property_value v join wos_spike.property_definition d on d.id = v.property_id where d.key = 'approved' and v.value_bool",
      )
    ).rows.filter((r) => visible.has(r.object_id)).length;
    expect(lead.total).toBe(approvedVisible);
    expect(lead.total).toBeLessThan(owner.total);
    expect(lead.groups!.reduce((sum, g) => sum + g.total, 0)).toBe(lead.total);
  });

  describe("relations never reveal a hidden object", () => {
    let task: { id: string; title: string };
    let project: { id: string; title: string };

    beforeAll(async () => {
      // A task the lead can see that points at a project the lead cannot see.
      const row = await one<{ task_id: string; task_title: string; project_id: string; project_title: string }>(
        `select t.id as task_id, t.title as task_title, p.id as project_id, p.title as project_title
         from wos_spike.object t
         join wos_spike.object_relation r on r.from_id = t.id
         join wos_spike.object p on p.id = r.to_id
         where t.space_id = $1 and t.archived_at is null
           and p.space_id is distinct from $1 and p.owner_id is distinct from $2
         order by t.title limit 1`,
        [familyFirst, QA.lead],
      );
      task = { id: row.task_id, title: row.task_title };
      project = { id: row.project_id, title: row.project_title };
    });

    it("the owner sees the link (control)", async () => {
      const r = await lens(QA.owner, { where: { and: [{ property: "title", operator: "equals", value: task.title }] }, select: ["project"] });
      expect(r.rows[0].values.project).toEqual([{ id: project.id, title: project.title }]);
    });

    it("the lead sees the task but not the hidden project's id or title", async () => {
      const r = await lens(QA.lead, { where: { and: [{ property: "title", operator: "equals", value: task.title }] }, select: ["project"] });
      expect(r.rows.map((x) => x.id)).toEqual([task.id]);
      expect(r.rows[0].values.project).toEqual([]);
    });

    it("the lead cannot find tasks by the hidden project's id or title", async () => {
      const byId = await lens(QA.lead, { where: { and: [{ property: "project", operator: "contains", value: project.id }] } });
      expect(byId.total).toBe(0);
      const byTitle = await lens(QA.lead, {
        where: { and: [{ property: "project", operator: "matches", value: { where: { and: [{ property: "title", operator: "equals", value: project.title }] } } }] },
      });
      expect(byTitle.total).toBe(0);
      const owner = await lens(QA.owner, { where: { and: [{ property: "project", operator: "contains", value: project.id }] } });
      expect(owner.total).toBeGreaterThan(0);
    });

    it("to the lead, the hidden link reads as empty", async () => {
      const r = await lens(QA.lead, {
        where: { and: [{ property: "title", operator: "equals", value: task.title }, { property: "project", operator: "is_empty" }] },
      });
      expect(r.total).toBe(1);
    });
  });

  it("custom values of hidden objects are not readable directly either", async () => {
    const client = await beginAsViewer(pool, QA.staff);
    try {
      const visible = await client.query("select count(*)::int as n from wos_spike.property_value");
      const own = await admin.query(
        "select count(*)::int as n from wos_spike.property_value v join wos_spike.object o on o.id = v.object_id where o.owner_id = $1",
        [QA.staff],
      );
      expect(visible.rows[0].n).toBe(own.rows[0].n);
    } finally {
      await end(client);
    }
  });
});
