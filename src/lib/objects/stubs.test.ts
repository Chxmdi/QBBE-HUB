import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { QuerySpec } from "./contracts";
import {
  createTaskQueryStub,
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
