import type { QueryRow, QuerySpec } from "@/lib/objects/contracts";
import type { LensCatalog } from "@/lib/query/catalog";
import { createLensRunQuery, type AdapterOptions } from "@/lib/query/contract-adapter";
import { objectHref } from "@/lib/query/links";
import type { RpcClient } from "@/lib/query/run";

/**
 * Runs a project block's query spec through the lens query engine (M8a, I2):
 * one path for every type the catalog knows, under the viewer's own client,
 * so row-level security decides the rows. A spec the engine cannot answer is
 * refused with a QueryError (src/lib/query/errors.ts) rather than half-answered.
 */

export interface BlockRow extends QueryRow {
  href: string;
}

/** Runs one block's spec through the engine as the viewer. */
export async function runBlockSpec(
  client: RpcClient,
  catalog: LensCatalog,
  spec: QuerySpec,
  options: AdapterOptions,
): Promise<BlockRow[]> {
  const result = await createLensRunQuery(client, catalog, options)(spec);
  return result.rows.map((row) => ({ ...row, href: objectHref(row) }));
}
