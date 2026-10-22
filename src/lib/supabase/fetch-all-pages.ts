/**
 * Reads a query or function result page by page (DATA-003).
 *
 * PostgREST returns at most `max_rows` rows per request (supabase/config.toml:
 * 1000) and gives no sign that it stopped early: `.limit(10000)` comes back
 * with 1,000 rows and no error. A report that trusts one request therefore
 * looks complete while it is not. This helper asks for consecutive `.range()`
 * pages until the server has nothing more, and stops at `limit` rows, saying
 * so with `truncated`, so a caller can refuse (HTTP 413) or show a notice
 * instead of shipping part of the data.
 *
 * The query behind `page` must have an order with no ties (finish it with a
 * unique column), or a row can repeat or go missing between pages.
 */

/** Rows asked for per request; equal to the server's max_rows. */
export const PAGE_SIZE = 1000;

export interface PageError {
  message: string;
  code?: string;
}

export interface PageResponse<T> {
  data: T[] | null;
  error: PageError | null;
}

export interface AllPages<T> {
  rows: T[];
  error: PageError | null;
  /** More rows exist than `limit`; `rows` holds the first `limit`. */
  truncated: boolean;
}

/**
 * `page(from, to)` runs the query with `.range(from, to)` (both inclusive).
 * Stops on an empty page rather than a short one, so a server cap below
 * PAGE_SIZE still yields every row. Reads at most `limit + 1` rows.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  limit: number,
): Promise<AllPages<T>> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("fetchAllPages needs a limit of at least one row");
  const rows: T[] = [];
  while (rows.length <= limit) {
    const want = Math.min(PAGE_SIZE, limit + 1 - rows.length);
    const { data, error } = await page(rows.length, rows.length + want - 1);
    if (error) return { rows, error, truncated: false };
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  if (rows.length > limit) return { rows: rows.slice(0, limit), error: null, truncated: true };
  return { rows, error: null, truncated: false };
}
