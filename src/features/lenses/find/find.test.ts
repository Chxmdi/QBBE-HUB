import { describe, expect, it } from "vitest";
import type { RpcClient } from "@/lib/query/run";
import { FindError, findForPalette, findRecords, parseFindParams } from "./find";

const row = (n: number) => ({
  result_type: "task", id: `id-${n}`, title: `T${n}`, snippet: null, href: `/my-work?task=id-${n}`,
  space_id: null, rank: 2, updated_at: null, total: "7",
});

describe("find", () => {
  it("sends only valid input, and maps rows and the total", async () => {
    const calls: unknown[] = [];
    const client: RpcClient = { rpc: async (fn, args) => (calls.push([fn, args]), { data: [row(1), row(2)], error: null }) };
    const page = await findRecords(client, { query: "  école  ", types: ["task"], limit: 2 });
    expect(calls).toEqual([["find", { p_query: "école", p_types: ["task"], p_space: null, p_limit: 2, p_offset: 0 }]]);
    expect(page.total).toBe(7);
    expect(page.results[0]).toEqual({ type: "task", id: "id-1", title: "T1", snippet: "", href: "/my-work?task=id-1", spaceId: null, rank: 2, updatedAt: null });
  });

  it("skips the round trip for queries that cannot match", async () => {
    let called = false;
    const client: RpcClient = { rpc: async () => ((called = true), { data: [], error: null }) };
    expect(await findRecords(client, { query: "a" })).toEqual({ results: [], total: 0 });
    expect(await findRecords(client, { query: "ab", types: ["nope" as "task"] })).toEqual({ results: [], total: 0 });
    expect(await findRecords(client, { query: "ab", space: "not-a-uuid" })).toEqual({ results: [], total: 0 });
    expect(called).toBe(false);
  });

  it("turns database errors into one generic error", async () => {
    const client: RpcClient = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    await expect(findRecords(client, { query: "abc" })).rejects.toBeInstanceOf(FindError);
  });

  it("parses the page URL, dropping anything invalid", () => {
    expect(parseFindParams({ q: " rapport ", type: "document", space: "11111111-1111-4111-8111-111111111111", page: "2" })).toEqual({
      query: "rapport", type: "document", space: "11111111-1111-4111-8111-111111111111", page: 2,
    });
    expect(parseFindParams({ q: ["a", "b"], type: "x", space: "y", page: "99" })).toEqual({ query: "a", type: null, space: null, page: 1 });
  });

  it("gives the palette labelled links", async () => {
    const client: RpcClient = { rpc: async () => ({ data: [row(1)], error: null }) };
    expect(await findForPalette(client, "t1", () => "Task")).toEqual([
      { id: "id-1", label: "T1", hint: "Task", href: "/my-work?task=id-1", type: "task" },
    ]);
  });
});
