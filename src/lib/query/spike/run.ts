// W0-8 spike: run a compiled lens as the viewer.
//
// The server connects as wos_spike_lens_runner, a login role that can become
// `authenticated` and nothing else (see supabase/spikes/w0-8-query/schema.sql).
// Each lens load is one READ ONLY transaction that switches to that role and
// sets the viewer's JWT claims exactly as PostgREST does, so auth.uid() and
// every RLS policy see the viewer. The caller must pass a user id taken from
// a verified session (supabase.auth.getUser / getClaims), never from input.
//
// Server-only: this file is not imported by any page or route.

import type { Pool, PoolClient } from "pg";
import { buildCatalog, type Catalog, type PropertyRow, type TypeRow } from "./catalog";
import { compileLens, type CompileContext, type CompiledLens, type OutputColumn } from "./compile";

export interface LensRow {
  id: string;
  title: string;
  space: string | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
  group: string | null;
  values: Record<string, unknown>;
}

export interface LensResult {
  rows: LensRow[];
  total: number;
  groups?: Array<{ key: string | null; total: number }>;
  timings: { catalogMs: number; compileMs: number; pageMs: number; countMs: number; groupsMs: number; totalMs: number };
}

const STATEMENT_TIMEOUT_MS = 5000;

/** Open a read-only transaction as the viewer. Always pair with `end`. */
export async function beginAsViewer(pool: Pool, viewerId: string): Promise<PoolClient> {
  const client = await pool.connect();
  try {
    await client.query("begin transaction read only");
    await client.query("set local role authenticated");
    await client.query(
      "select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true), set_config('statement_timeout', $3, true)",
      [JSON.stringify({ sub: viewerId, role: "authenticated", aal: "aal1" }), viewerId, String(STATEMENT_TIMEOUT_MS)],
    );
    return client;
  } catch (error) {
    client.release(true);
    throw error;
  }
}

export async function end(client: PoolClient): Promise<void> {
  try {
    await client.query("rollback");
  } finally {
    client.release();
  }
}

export async function loadCatalog(client: PoolClient): Promise<Catalog> {
  const types = await client.query<TypeRow>("select id, key from wos_spike.object_type");
  const props = await client.query<PropertyRow>(
    "select id, type_id, key, name_en, name_fr, kind, options, target_type_id from wos_spike.property_definition order by position",
  );
  return buildCatalog(types.rows, props.rows);
}

function decode(columns: OutputColumn[], props: Record<string, unknown[]>, rels: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    if (c.source === "system") continue;
    if (c.kind === "relation") {
      out[c.key] = rels[c.id!] ?? [];
      continue;
    }
    const v = props[c.id!];
    if (!v) {
      out[c.key] = null;
      continue;
    }
    const [text, num, date, bool, json] = v;
    out[c.key] =
      c.kind === "number" ? (num === null ? null : Number(num))
      : c.kind === "date" ? date
      : c.kind === "checkbox" ? bool
      : c.kind === "multi_select" || c.kind === "person" ? json
      : text;
  }
  return out;
}

const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6;

/** Compile and run one lens page (rows + total count + group counts) as the viewer. */
export async function runLens(
  pool: Pool,
  spec: unknown,
  ctx: CompileContext,
): Promise<LensResult & { compiled: CompiledLens }> {
  const t0 = process.hrtime.bigint();
  const client = await beginAsViewer(pool, ctx.viewerId);
  try {
    let t = process.hrtime.bigint();
    const catalog = await loadCatalog(client);
    const catalogMs = ms(t);

    t = process.hrtime.bigint();
    const compiled = compileLens(spec, catalog, ctx);
    const compileMs = ms(t);

    t = process.hrtime.bigint();
    const page = await client.query(compiled.page.text, compiled.page.values);
    const pageMs = ms(t);

    t = process.hrtime.bigint();
    const count = await client.query<{ total: number }>(compiled.count.text, compiled.count.values);
    const countMs = ms(t);

    t = process.hrtime.bigint();
    const groups = compiled.groups ? await client.query<{ group_key: string | null; total: number }>(compiled.groups.text, compiled.groups.values) : undefined;
    const groupsMs = ms(t);

    const rows: LensRow[] = page.rows.map((r) => ({
      id: r.id,
      title: r.title,
      space: r.space_id,
      owner: r.owner_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      group: r.group_key,
      values: decode(compiled.columns, r.props, r.relations),
    }));
    return {
      compiled,
      rows,
      total: count.rows[0].total,
      groups: groups?.rows.map((g) => ({ key: g.group_key, total: g.total })),
      timings: { catalogMs, compileMs, pageMs, countMs, groupsMs, totalMs: ms(t0) },
    };
  } finally {
    await end(client);
  }
}
