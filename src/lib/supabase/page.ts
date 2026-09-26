import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const QUERY_STARTS = new Set(["select", "insert", "update", "upsert", "delete"]);

/**
 * Wraps a query builder so every query it starts rejects on a PostgREST or
 * network error instead of resolving to `{ data: null, error }`.
 */
function throwingQuery<T extends object>(builder: T): T {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && QUERY_STARTS.has(prop)) {
        return (...args: unknown[]) => {
          const query = value.apply(target, args) as { throwOnError(): unknown };
          return query.throwOnError();
        };
      }
      return value.bind(target);
    },
  });
}

/**
 * The Supabase client for Server Component **pages** (P0-UX-05, #100).
 *
 * Pages read `{ data }` and render an empty state when it is empty. With the
 * ordinary client a failed read also produces empty `data`, so a database
 * outage rendered as "No projects yet" and the workspace error boundary,
 * which offers Try again, was never reached. Every query started from this
 * client throws on error instead, so a failure reaches `(workspace)/error.tsx`.
 *
 * Only for page reads. Server actions keep `createSupabaseServerClient`,
 * because they turn errors into messages for the form that called them.
 * RLS still decides what a query returns: a row the reader may not see is an
 * empty result, not an error, so this changes nothing about authorization.
 */
export async function createSupabasePageClient(): Promise<ServerClient> {
  const client = await createSupabaseServerClient();
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (relation: string) => throwingQuery(target.from(relation));
      }
      if (prop === "schema") {
        return (schema: string) => {
          const scoped = target.schema(schema as never);
          return new Proxy(scoped, {
            get(inner, key, innerReceiver) {
              if (key === "from") {
                return (relation: string) => throwingQuery(inner.from(relation));
              }
              const value = Reflect.get(inner, key, innerReceiver);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        };
      }
      if (prop === "rpc") {
        return (...args: Parameters<ServerClient["rpc"]>) =>
          target.rpc(...args).throwOnError();
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
