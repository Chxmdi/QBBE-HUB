import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A scripted stand-in for the parts of supabase-js the action call sites use:
 * `from(table)` chains (select / insert / update / delete / upsert with eq, is,
 * in, not, order, limit, range, maybeSingle, single) and `rpc(fn, args)`. Each
 * call is answered by the handlers given and recorded for assertions. Test
 * support only.
 */

export interface TableCall {
  table: string;
  action: "select" | "insert" | "update" | "delete" | "upsert";
  payload: unknown;
  filters: { op: string; column: string; value: unknown }[];
  columns: string | null;
  single: boolean;
}

export interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

export type Answer = { data: unknown; error: { message: string; code?: string } | null };

export interface FakeDbHandlers {
  table?: (call: TableCall) => Answer | Promise<Answer>;
  rpc?: (call: RpcCall) => Answer | Promise<Answer>;
}

export function fakeDb(handlers: FakeDbHandlers) {
  const tableCalls: TableCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const answer = (call: TableCall): Promise<Answer> =>
    Promise.resolve(handlers.table ? handlers.table(call) : { data: null, error: null });

  const chain = (call: TableCall) => {
    const self: Record<string, unknown> = {};
    const filter = (op: string) => (column: string, value?: unknown) => {
      call.filters.push({ op, column, value });
      return self;
    };
    Object.assign(self, {
      select: (columns?: string) => {
        if (call.action === "select" || !call.columns) call.columns = columns ?? "*";
        if (call.action !== "select" && call.columns === null) call.columns = columns ?? "*";
        return self;
      },
      insert: (payload: unknown) => Object.assign(self, { ...self }) && setAction("insert", payload),
      update: (payload: unknown) => setAction("update", payload),
      delete: () => setAction("delete", null),
      upsert: (payload: unknown) => setAction("upsert", payload),
      eq: filter("eq"),
      neq: filter("neq"),
      is: filter("is"),
      in: filter("in"),
      not: (column: string, op: string, value: unknown) => filter(`not.${op}`)(column, value),
      or: (value: string) => filter("or")("", value),
      gt: filter("gt"),
      gte: filter("gte"),
      lt: filter("lt"),
      order: () => self,
      limit: () => self,
      range: () => self,
      maybeSingle: () => {
        call.single = true;
        return answer(call);
      },
      single: () => {
        call.single = true;
        return answer(call);
      },
      then: (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
        answer(call).then(resolve, reject),
    });
    function setAction(action: TableCall["action"], payload: unknown) {
      call.action = action;
      call.payload = payload;
      return self;
    }
    return self;
  };

  const db = {
    from(table: string) {
      const call: TableCall = { table, action: "select", payload: null, filters: [], columns: null, single: false };
      tableCalls.push(call);
      return chain(call);
    },
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const call = { fn, args };
      rpcCalls.push(call);
      return handlers.rpc ? handlers.rpc(call) : { data: null, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, tableCalls, rpcCalls };
}

/** The change_set row public.record_change_set returns. */
export function changeSetRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: "44444444-4444-4444-8444-444444444444",
    action_key: "x.y",
    actor_kind: "person",
    actor_id: null,
    created_at: "2026-10-01T12:00:00.000Z",
    undo_of: null,
    undone_at: null,
    ...extra,
  };
}
