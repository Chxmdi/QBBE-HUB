export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface PagedQuery<T> {
  order(column: string): {
    range(from: number, to: number): PromiseLike<PageResult<T>>;
  };
}

/** Stable ordering plus an empty terminal page handles server-side row caps. */
export async function readAll<T>(query: PagedQuery<T>, orderColumn = "id"): Promise<PageResult<T>> {
  const rows: T[] = [];
  const ordered = query.order(orderColumn);
  while (true) {
    const { data, error } = await ordered.range(rows.length, rows.length + 499);
    if (error) return { data: null, error };
    if (!data?.length) return { data: rows, error: null };
    rows.push(...data);
  }
}
