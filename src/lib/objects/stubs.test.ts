import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { ActionContext, Change, QuerySpec } from "./contracts";
import {
  createActionRegistryStub,
  createCanStub,
  createEventWriterStub,
  createTaskQueryStub,
  invertChanges,
  QueryNotSupportedError,
  resolveValue,
  serializeFilter,
  taskSystemProperties,
} from "./stubs";

interface Captured {
  url: URL;
  method: string;
  body: unknown;
}

// A real supabase-js client, so the query builders run for real; only the
// network is replaced and every request is kept for inspection.
function fakeClient(respond: (request: Captured) => Response) {
  const requests: Captured[] = [];
  const client = createClient("https://project.supabase.co", "anon-key", {
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = {
          url: new URL(String(input)),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        };
        requests.push(request);
        return respond(request);
      },
    },
  });
  return { client, requests };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const me = "11111111-1111-1111-1111-111111111111";
const task = "22222222-2222-2222-2222-222222222222";
const project = "33333333-3333-3333-3333-333333333333";
// Wednesday 30 September 2026, 10:00 in Toronto.
const context = { userId: me, now: () => new Date("2026-09-30T14:00:00Z") };

describe("can stub", () => {
  it("asks the database's public.can with the object and capability", async () => {
    const { client, requests } = fakeClient(() => json(true));
    expect(await createCanStub(client)(task, "edit_content")).toBe(true);
    expect(requests[0].url.pathname).toBe("/rest/v1/rpc/can");
    expect(requests[0].body).toEqual({ object_id: task, capability: "edit_content" });
  });

  it("answers false when the database says no", async () => {
    const { client } = fakeClient(() => json(false));
    expect(await createCanStub(client)(task, "manage")).toBe(false);
  });

  it("fails closed on a database error", async () => {
    const { client } = fakeClient(() => json({ message: "boom" }, 500));
    expect(await createCanStub(client)(task, "view")).toBe(false);
  });

  it("refuses an unknown capability without asking", async () => {
    const { client, requests } = fakeClient(() => json(true));
    // @ts-expect-error: not a Workspace OS capability
    expect(await createCanStub(client)(task, "delete_everything")).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("relative values", () => {
  it("resolves me to the viewer", () => {
    expect(resolveValue({ relative: "me" }, taskSystemProperties.assignee, context)).toEqual({ point: me });
  });

  it("resolves today to the organization's calendar date", () => {
    // 01:00 UTC on 1 October is still 30 September in Toronto.
    const lateEvening = { ...context, now: () => new Date("2026-10-01T01:00:00Z") };
    expect(resolveValue({ relative: "today" }, taskSystemProperties.due, lateEvening)).toEqual({
      point: "2026-09-30",
    });
  });

  it("resolves this week to Monday through the next Monday", () => {
    expect(resolveValue({ relative: "this_week" }, taskSystemProperties.due, context)).toEqual({
      from: "2026-09-28",
      to: "2026-10-05",
    });
  });

  it("resolves today on a timestamp to the local day's instants", () => {
    expect(resolveValue({ relative: "today" }, taskSystemProperties.created_time, context)).toEqual({
      from: "2026-09-30T04:00:00.000Z",
      to: "2026-10-01T04:00:00.000Z",
    });
  });

  it("counts days from today", () => {
    expect(
      resolveValue({ relative: "days_from_today", days: -3 }, taskSystemProperties.due, context),
    ).toEqual({ point: "2026-09-27" });
  });

  it("refuses a date value on a property that is not a date", () => {
    expect(() => resolveValue({ relative: "today" }, taskSystemProperties.status, context)).toThrow(
      QueryNotSupportedError,
    );
  });
});

describe("filter serialization", () => {
  it("nests and/or groups", () => {
    expect(
      serializeFilter(
        {
          and: [
            { property: "assignee", op: "eq", value: { relative: "me" } },
            {
              or: [
                { property: "status", op: "eq", value: "blocked" },
                { property: "due", op: "lt", value: { relative: "today" } },
              ],
            },
          ],
        },
        context,
      ),
    ).toBe(`and(assignee_id.eq."${me}",or(status.eq."blocked",due_at.lt."2026-09-30"))`);
  });

  it("quotes values so commas, parentheses and quotes stay literal", () => {
    expect(serializeFilter({ property: "title", op: "contains", value: 'a,b) "c"' }, context)).toBe(
      'title.ilike."*a,b) \\"c\\"*"',
    );
  });

  it("expands a week to a range", () => {
    expect(serializeFilter({ property: "due", op: "eq", value: { relative: "this_week" } }, context)).toBe(
      'and(due_at.gte."2026-09-28",due_at.lt."2026-10-05")',
    );
    expect(serializeFilter({ property: "due", op: "neq", value: { relative: "this_week" } }, context)).toBe(
      'or(due_at.lt."2026-09-28",due_at.gte."2026-10-05")',
    );
  });

  it("handles lists, emptiness and numbers", () => {
    expect(serializeFilter({ property: "priority", op: "in", value: ["high", "urgent"] }, context)).toBe(
      'priority.in.("high","urgent")',
    );
    expect(serializeFilter({ property: "project", op: "is_empty" }, context)).toBe("project_id.is.null");
    expect(serializeFilter({ property: "estimate", op: "gte", value: 2 }, context)).toBe(
      "estimate_hours.gte.2",
    );
  });

  it("refuses unknown properties and relation traversal", () => {
    expect(() => serializeFilter({ property: "secret", op: "eq", value: 1 }, context)).toThrow(
      QueryNotSupportedError,
    );
    expect(() =>
      serializeFilter({ property: { via: ["project"], property: "status" }, op: "eq", value: "x" }, context),
    ).toThrow(QueryNotSupportedError);
  });
});

describe("task query stub", () => {
  const rows = [
    { id: task, title: "Book the hall", status: "in_progress", project_id: project, due_at: "2026-10-02" },
    { id: "44444444-4444-4444-4444-444444444444", title: "Order chairs", status: "blocked", project_id: null, due_at: null },
    { id: "55555555-5555-5555-5555-555555555555", title: "Extra row", status: "blocked", project_id: null, due_at: null },
  ];

  it("reads tasks through the caller's client with the filter, sort and page", async () => {
    const { client, requests } = fakeClient(() => json(rows));
    const spec: QuerySpec = {
      version: 1,
      types: ["task"],
      filter: { property: "status", op: "neq", value: "done" },
      sorts: [{ property: "due", direction: "asc" }],
      properties: ["status", "project", "due"],
      groupBy: "status",
      limit: 2,
    };
    const result = await createTaskQueryStub(client, context)(spec);

    const url = requests[0].url;
    expect(url.pathname).toBe("/rest/v1/task");
    expect(url.searchParams.get("select")).toBe("id,title,status,project_id,due_at");
    expect(url.searchParams.get("archived_at")).toBe("is.null");
    expect(url.searchParams.get("or")).toBe('(and(status.neq."done"))');
    expect(url.searchParams.get("order")).toBe("due_at.asc.nullslast,id.asc");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("3");

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      ref: { id: task, type: "task" },
      title: "Book the hall",
      values: {
        title: { kind: "text", value: "Book the hall" },
        status: { kind: "status", value: "in_progress" },
        project: { kind: "relation", value: [{ id: project, type: "project" }] },
        due: { kind: "date", value: "2026-10-02" },
      },
    });
    expect(result.rows[1].values.project).toBeNull();
    expect(result.nextCursor).toBe("2");
    expect(result.groups).toEqual([
      { key: "in_progress", rowIds: [task] },
      { key: "blocked", rowIds: ["44444444-4444-4444-4444-444444444444"] },
    ]);
  });

  it("continues from a cursor and stops at the end", async () => {
    const { client, requests } = fakeClient(() => json(rows.slice(2)));
    const result = await createTaskQueryStub(client, context)({ version: 1, types: ["task"], limit: 2, cursor: "2" });
    expect(requests[0].url.searchParams.get("offset")).toBe("2");
    expect(requests[0].url.searchParams.get("order")).toBe("created_at.desc.nullslast,id.asc");
    expect(result.nextCursor).toBeNull();
  });

  it("answers task queries only", async () => {
    const { client, requests } = fakeClient(() => json([]));
    const run = createTaskQueryStub(client, context);
    await expect(run({ version: 1, types: ["project"] })).rejects.toThrow(QueryNotSupportedError);
    await expect(run({ version: 1, types: ["task", "project"] })).rejects.toThrow(QueryNotSupportedError);
    await expect(run({ version: 1, types: ["task"], cursor: "-1" })).rejects.toThrow(QueryNotSupportedError);
    expect(requests).toHaveLength(0);
  });

  it("surfaces a database error instead of an empty list", async () => {
    const { client } = fakeClient(() => json({ message: "permission denied for table task" }, 403));
    await expect(createTaskQueryStub(client, context)({ version: 1, types: ["task"] })).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("action registry stub", () => {
  const ref = { id: task, type: "task" };
  const setStatus = {
    key: "task.set_status",
    label: { en: "Change status", fr: "Changer le statut" },
    capability: "edit_content" as const,
    targets: (input: { id: string }) => [input.id],
    run: async (_context: ActionContext, input: { id: string; status: string }): Promise<Change[]> => [
      { kind: "update", object: { id: input.id, type: "task" }, property: "status", before: "not_started", after: input.status },
    ],
  };

  function setup(allowed: (id: string, capability: string) => boolean) {
    const applied: Change[][] = [];
    const registry = createActionRegistryStub({
      apply: async (changes) => {
        applied.push(changes);
      },
      now: () => new Date("2026-09-30T14:00:00Z"),
      newId: (() => {
        let n = 0;
        return () => `change-set-${++n}`;
      })(),
    });
    registry.register(setStatus);
    const actionContext: ActionContext = {
      actor: { kind: "person", id: me },
      can: async (id, capability) => allowed(id, capability),
    };
    return { registry, applied, actionContext };
  }

  it("runs an action and records its change set", async () => {
    const { registry, actionContext } = setup(() => true);
    const result = await registry.run("task.set_status", { id: task, status: "done" }, actionContext);
    expect(result).toEqual({
      ok: true,
      changeSet: {
        id: "change-set-1",
        actionKey: "task.set_status",
        actor: { kind: "person", id: me },
        createdAt: "2026-09-30T14:00:00.000Z",
        changes: [{ kind: "update", object: ref, property: "status", before: "not_started", after: "done" }],
        undoOf: null,
      },
    });
  });

  it("checks the declared capability on every target first", async () => {
    const asked: string[] = [];
    const { registry, actionContext } = setup((id, capability) => {
      asked.push(`${id}:${capability}`);
      return false;
    });
    expect(await registry.run("task.set_status", { id: task, status: "done" }, actionContext)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(asked).toEqual([`${task}:edit_content`]);
  });

  it("undoes by applying the reverse change set", async () => {
    const { registry, applied, actionContext } = setup(() => true);
    const done = await registry.run("task.set_status", { id: task, status: "done" }, actionContext);
    if (!done.ok) throw new Error("expected the action to run");
    const undone = await registry.undo(done.changeSet.id, actionContext);
    expect(applied).toEqual([
      [{ kind: "update", object: ref, property: "status", before: "done", after: "not_started" }],
    ]);
    expect(undone.ok && undone.changeSet.undoOf).toBe("change-set-1");
  });

  it("refuses to undo without the capability, and reports unknown actions", async () => {
    let allow = true;
    const { registry, applied, actionContext } = setup(() => allow);
    const done = await registry.run("task.set_status", { id: task, status: "done" }, actionContext);
    if (!done.ok) throw new Error("expected the action to run");
    allow = false;
    expect(await registry.undo(done.changeSet.id, actionContext)).toEqual({ ok: false, reason: "forbidden" });
    expect(applied).toHaveLength(0);
    expect(await registry.undo("missing", actionContext)).toEqual({ ok: false, reason: "unknown_action" });
    expect(await registry.run("missing", {}, actionContext)).toEqual({ ok: false, reason: "unknown_action" });
  });

  it("reports a failing action without recording it", async () => {
    const { registry, actionContext } = setup(() => true);
    registry.register({ ...setStatus, key: "task.broken", run: async () => Promise.reject(new Error("nope")) });
    expect(await registry.run("task.broken", { id: task }, actionContext)).toEqual({
      ok: false,
      reason: "failed",
      message: "nope",
    });
  });

  it("will not register the same action twice", () => {
    const { registry } = setup(() => true);
    expect(() => registry.register(setStatus)).toThrow("already registered");
  });

  it("inverts every kind of change, last change first", () => {
    const relation = { relationTypeKey: "blocks", from: ref, to: { id: project, type: "project" } };
    expect(
      invertChanges([
        { kind: "create", object: ref, values: { title: "x" } },
        { kind: "link", relation },
        { kind: "unlink", relation },
        { kind: "delete", object: ref, values: { title: "x" } },
      ]),
    ).toEqual([
      { kind: "create", object: ref, values: { title: "x" } },
      { kind: "link", relation },
      { kind: "unlink", relation },
      { kind: "delete", object: ref, values: { title: "x" } },
    ]);
  });
});

describe("event writer stub", () => {
  const event = {
    object: { id: task, type: "task" },
    organizationId: "66666666-6666-6666-6666-666666666666",
    verb: "updated" as const,
    changes: [{ property: "status", before: "not_started", after: "done" }],
    summary: "completed “Book the hall”",
    projectId: project,
  };

  it("writes today's activity feed row with the changes in metadata", async () => {
    const { client, requests } = fakeClient(() => new Response(null, { status: 201 }));
    await createEventWriterStub(client)({ ...event, actor: { kind: "person", id: me }, changeSetId: "cs-1" });
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url.pathname).toBe("/rest/v1/activity_event");
    expect(requests[0].body).toEqual({
      organization_id: event.organizationId,
      actor_id: me,
      verb: "updated",
      source_type: "task",
      source_id: task,
      project_id: project,
      program_id: null,
      summary: event.summary,
      metadata: { actor: { kind: "person", id: me }, changes: event.changes, change_set_id: "cs-1" },
    });
  });

  it("keeps a non-person actor out of the person column", async () => {
    const { client, requests } = fakeClient(() => new Response(null, { status: 201 }));
    const actor = { kind: "automation" as const, id: "77777777-7777-7777-7777-777777777777" };
    await createEventWriterStub(client)({ ...event, actor });
    const body = requests[0].body as { actor_id: unknown; metadata: { actor: unknown } };
    expect(body.actor_id).toBeNull();
    expect(body.metadata.actor).toEqual(actor);
  });

  it("throws when the row is refused", async () => {
    const { client } = fakeClient(() => json({ message: "new row violates row-level security policy" }, 403));
    await expect(createEventWriterStub(client)({ ...event, actor: { kind: "person", id: me } })).rejects.toThrow(
      "row-level security",
    );
  });
});
