import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const QUERY_STARTS = new Set(["select", "insert", "update", "upsert", "delete"]);

/**
 * Postgres refuses a value that cannot be read as its column's type with
 * `22P02` (invalid_text_representation): the id in the address was not a
 * UUID, a date was not a date. On a page that value came from the address
 * bar, so the honest answer is "Not found — or not yours to see", the same
 * page a well-formed id that matches nothing gets. Thrown as a query error
 * it reached the workspace error boundary instead ("Something went wrong",
 * Try again), which is wrong twice: nothing went wrong, and trying again
 * cannot help. Verified on /projects/<not-a-uuid>, /meetings/<…>,
 * /channels/<…> and /goals/<…>.
 */
const INVALID_TEXT_REPRESENTATION = "22P02";

function notFoundOnBadInput(error: unknown): never {
  if ((error as { code?: unknown } | null)?.code === INVALID_TEXT_REPRESENTATION) notFound();
  throw error;
}

/**
 * Wraps a query builder so awaiting it rejects with the real error, and a
 * `22P02` becomes the not-found page. Builder methods return the same builder
 * (`.eq().order().maybeSingle()`), so the wrapper follows the chain: every
 * method that hands back the builder hands back the wrapper instead, and the
 * final `await` lands on the wrapper's `then`.
 */
function followingChain<T extends object>(builder: T): T {
  const proxy: T = new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        const then = Reflect.get(target, prop, receiver) as (
          onFulfilled?: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) => Promise<unknown>;
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
          then.call(target, onFulfilled, (reason: unknown) => {
            try {
              notFoundOnBadInput(reason);
            } catch (translated) {
              if (onRejected) return onRejected(translated);
              throw translated;
            }
          });
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

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
          const query = value.apply(target, args) as { throwOnError(): object };
          return followingChain(query.throwOnError());
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
 * A value from the address that the database cannot read as its type (an id
 * that is not a UUID) renders the not-found page instead; see
 * notFoundOnBadInput.
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
          followingChain(target.rpc(...args).throwOnError());
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
