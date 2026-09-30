import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { toCatalog, type LensCatalog } from "./catalog";
import { QueryError, queryErrorFrom } from "./errors";
import { lensSpecSchema, LIMITS, measure, type LensPropertyKind, type LensSpec } from "./spec";
import type { PropertyKind } from "@/lib/objects/contracts";

/**
 * Runs lens queries through the viewer's own Supabase session (M8a).
 *
 * The SQL is built and executed by `public.lens_query`, a caller's-rights
 * function, so row-level security decides every row and no service role is
 * involved. Pass the request's server client (createSupabaseServerClient) or,
 * in a client component, the browser client: both carry the viewer's JWT.
 */

type RpcResult = PromiseLike<{ data: unknown; error: { message?: string } | null }>;
export interface RpcClient {
  rpc: (fn: string, args?: Record<string, unknown>) => RpcResult;
}

/** A reference value: a person, program or related object with its label. */
export interface RefValue {
  id: string;
  label: string | null;
}
export type LensValue = string | number | boolean | RefValue | null;

export interface LensRow {
  id: string;
  title: string;
  /** The row's group key when the spec has groupBy. */
  group: string | null;
  values: Record<string, LensValue>;
}

export interface LensGroupCount {
  key: string | null;
  /** Shown for reference groups (people, projects, programs). */
  label: { id: string; label: string | null } | null;
  total: number;
}

export interface LensColumn {
  key: string;
  kind: LensPropertyKind;
  propertyKind: PropertyKind;
}

export interface LensResult {
  type: string;
  columns: LensColumn[];
  groupBy: string | null;
  rows: LensRow[];
  total: number;
  groups: LensGroupCount[] | null;
  limit: number;
  offset: number;
}

export interface RunOptions {
  /** IANA zone for "today" and "this week". The viewer's, from the session. */
  timeZone?: string;
}

/** Strict parse plus the limits the schema cannot express. Throws QueryError. */
export function parseLensSpec(input: unknown): LensSpec {
  const parsed = lensSpecSchema.safeParse(input);
  if (!parsed.success) throw new QueryError("invalid_spec", "The query is not in the expected format.");
  if (parsed.data.where) {
    const { conditions, depth } = measure(parsed.data.where);
    if (conditions > LIMITS.maxConditions) throw new QueryError("too_complex", "Too many conditions.");
    if (depth > LIMITS.maxDepth) throw new QueryError("too_complex", "Filters are nested too deeply.");
  }
  return parsed.data;
}

export async function runLens(
  client: RpcClient,
  input: unknown,
  options: RunOptions = {},
): Promise<LensResult> {
  const spec = parseLensSpec(input);
  const { data, error } = await client.rpc("lens_query", {
    spec,
    time_zone: options.timeZone ?? DEFAULT_TIME_ZONE,
  });
  if (error || !data) throw queryErrorFrom(error);
  const result = data as LensResult;
  return {
    ...result,
    rows: result.rows ?? [],
    groups: result.groups ?? null,
    columns: result.columns ?? [],
  };
}

export async function loadCatalog(client: RpcClient): Promise<LensCatalog> {
  const { data, error } = await client.rpc("lens_catalog");
  if (error || !data) throw queryErrorFrom(error);
  return toCatalog(data as Parameters<typeof toCatalog>[0]);
}

/**
 * Every row of a lens up to `maxRows`, in order: the first page, then the
 * remaining pages at once (the total is known after the first). Each page is
 * its own engine call under the viewer's RLS, so the result is the same as
 * paging by hand.
 */
export async function runLensAll(
  client: RpcClient,
  input: unknown,
  options: RunOptions & { maxRows?: number } = {},
): Promise<LensResult> {
  const spec = parseLensSpec(input);
  const pageSize = spec.limit ?? LIMITS.maxPageSize;
  const start = spec.offset ?? 0;
  const first = await runLens(client, { ...spec, limit: pageSize, offset: start }, options);
  const end = Math.min(first.total, start + (options.maxRows ?? LIMITS.maxOffset + pageSize));
  const offsets: number[] = [];
  for (let offset = start + first.rows.length; offset < end && offset <= LIMITS.maxOffset; offset += pageSize) {
    offsets.push(offset);
  }
  const pages = await Promise.all(offsets.map((offset) => runLens(client, { ...spec, limit: pageSize, offset }, options)));
  return { ...first, rows: [first, ...pages].flatMap((page) => page.rows).slice(0, Math.max(0, end - start)), offset: start };
}
