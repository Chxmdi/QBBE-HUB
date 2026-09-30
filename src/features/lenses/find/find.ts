import { z } from "zod";
import type { RpcClient } from "@/lib/query/run";

/**
 * Find (M12): one search across every kind of record, for the search page and
 * the command palette. Runs `public.find` with the caller's own session, so
 * RLS decides what comes back. French-aware: accents and case are ignored,
 * every word must appear, and descriptions also match by stem.
 */

export const FIND_TYPES = [
  "task",
  "project",
  "program",
  "meeting",
  "decision",
  "event",
  "document",
  "risk",
  "issue",
  "contact",
  "crm",
  "person",
  "opportunity",
] as const;
export type FindType = (typeof FIND_TYPES)[number];

export const FIND_PAGE_SIZE = 20;

export interface FindResult {
  type: FindType;
  id: string;
  title: string;
  snippet: string;
  href: string;
  spaceId: string | null;
  rank: number;
  updatedAt: string | null;
}

export interface FindPage {
  results: FindResult[];
  total: number;
}

const uuid = z.string().uuid();

export const findInputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  types: z.array(z.enum(FIND_TYPES)).max(FIND_TYPES.length).optional(),
  space: uuid.optional(),
  limit: z.number().int().min(1).max(100).default(FIND_PAGE_SIZE),
  offset: z.number().int().min(0).max(1000).default(0),
});
export type FindInput = z.input<typeof findInputSchema>;

/** Reads the search page's URL. Anything invalid is dropped, never an error. */
export function parseFindParams(params: Record<string, string | string[] | undefined>): {
  query: string;
  type: FindType | null;
  space: string | null;
  page: number;
} {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const type = one(params.type);
  const space = one(params.space);
  const page = Number.parseInt(one(params.page), 10);
  return {
    query: one(params.q).trim().slice(0, 200),
    type: (FIND_TYPES as readonly string[]).includes(type) ? (type as FindType) : null,
    space: uuid.safeParse(space).success ? space : null,
    page: Number.isInteger(page) && page >= 1 && page <= 50 ? page : 1,
  };
}

interface Row {
  result_type: FindType;
  id: string;
  title: string;
  snippet: string | null;
  href: string;
  space_id: string | null;
  rank: number;
  updated_at: string | null;
  total: number | string;
}

export class FindError extends Error {
  constructor() {
    super("Search is not available.");
    this.name = "FindError";
  }
}

/** One page of results. Too-short queries return nothing without a round trip. */
export async function findRecords(client: RpcClient, input: FindInput): Promise<FindPage> {
  const parsed = findInputSchema.safeParse(input);
  if (!parsed.success) return { results: [], total: 0 };
  const { query, types, space, limit, offset } = parsed.data;
  const { data, error } = await client.rpc("find", {
    p_query: query,
    p_types: types?.length ? types : null,
    p_space: space ?? null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new FindError();
  const rows = (data ?? []) as Row[];
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    results: rows.map((r) => ({
      type: r.result_type,
      id: r.id,
      title: r.title,
      snippet: r.snippet ?? "",
      href: r.href,
      spaceId: r.space_id,
      rank: Number(r.rank),
      updatedAt: r.updated_at,
    })),
  };
}

/** The command palette's shape: a short list of labelled links. */
export interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  href: string;
  type: FindType;
}

/**
 * For the command palette (integration wires it): the best matches, each with
 * a short hint (the record type, translated by the caller).
 */
export async function findForPalette(
  client: RpcClient,
  query: string,
  typeLabel: (type: FindType) => string,
  limit = 8,
): Promise<PaletteItem[]> {
  const page = await findRecords(client, { query, limit });
  return page.results.map((r) => ({ id: r.id, label: r.title, hint: typeLabel(r.type), href: r.href, type: r.type }));
}
