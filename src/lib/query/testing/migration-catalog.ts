import { readFileSync } from "node:fs";
import path from "node:path";
import { toCatalog, type LensCatalog } from "../catalog";

/**
 * Test helper: the engine's real allow-list, read out of the migration that
 * defines `public.lens_catalog()`. Unit tests use it so a spec that passes
 * here is one the database accepts too; the database tests prove the rest.
 */
const MIGRATION = "20261107020100_lens_catalog_more_types.sql";

export function migrationCatalog(): LensCatalog {
  const file = path.resolve(process.cwd(), "supabase/migrations", MIGRATION);
  const sql = readFileSync(file, "utf8");
  const start = sql.indexOf("select $json$");
  const end = sql.indexOf("$json$::jsonb", start);
  if (start < 0 || end < 0) throw new Error(`No catalog JSON in ${MIGRATION}.`);
  const raw = JSON.parse(sql.slice(start + "select $json$".length, end));
  return toCatalog(raw);
}
