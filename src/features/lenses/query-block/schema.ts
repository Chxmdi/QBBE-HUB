import { z } from "zod";
import { lensSpecSchema } from "@/lib/query/spec";

/**
 * The props of a query block (M8e): a live lens embedded in a page. The
 * editor stream stores these in the block and renders <QueryBlock {...props}/>.
 *
 * A block points at a saved lens (`lensId`) or carries its own spec. Either
 * way it runs as whoever is reading the page, so two readers of the same page
 * can see different rows, and nobody sees a row they could not open anyway.
 */
export const QUERY_BLOCK_VIEWS = ["table", "list", "board"] as const;
export type QueryBlockView = (typeof QUERY_BLOCK_VIEWS)[number];

export const QUERY_BLOCK_MAX_ROWS = 200;

export const queryBlockPropsSchema = z
  .object({
    source: z.union([
      z.object({ lensId: z.string().uuid() }).strict(),
      z.object({ spec: lensSpecSchema }).strict(),
    ]),
    view: z.enum(QUERY_BLOCK_VIEWS).default("table"),
    title: z.string().trim().max(120).optional(),
    maxRows: z.number().int().min(1).max(QUERY_BLOCK_MAX_ROWS).default(25),
    /** Columns to show; defaults to the spec's select, then the title only. */
    columns: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(8).optional(),
  })
  .strict();

export type QueryBlockProps = z.input<typeof queryBlockPropsSchema>;
export type ParsedQueryBlockProps = z.output<typeof queryBlockPropsSchema>;

/** Parses stored block props; a block with bad props renders its error state, never crashes the page. */
export function parseQueryBlockProps(input: unknown): ParsedQueryBlockProps | null {
  const parsed = queryBlockPropsSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
