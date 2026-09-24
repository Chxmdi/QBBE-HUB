/** Newest page of channel/DM history. Older pages load on demand (Unit 14). */
export const CHANNEL_HISTORY_PAGE_SIZE = 100;

type Ordered = { id: string; created_at: string };

/**
 * History is ordered by `created_at`, then `id`. The tie-break matters:
 * messages imported or written in one transaction share a timestamp, and a
 * cursor on the timestamp alone skips every one of them that falls on a page
 * boundary — permanently, since no later page asks for them either.
 */
export function compareMessages(a: Ordered, b: Ordered): number {
  // As instants, since the API may print the same precision differently;
  // then by id, compared the way Postgres compares a uuid's hex text.
  const byTime = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (byTime) return byTime;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Merges two slices of history, keeping one copy of each message, in order. */
export function mergeMessages<T extends Ordered>(left: T[], right: T[]): T[] {
  const byId = new Map<string, T>();
  for (const message of [...left, ...right]) byId.set(message.id, message);
  return [...byId.values()].sort(compareMessages);
}

/** Whether `message` comes strictly before `cursor` in history order. */
export function isOlderThan(message: Ordered, cursor: Ordered): boolean {
  return compareMessages(message, cursor) < 0;
}

/**
 * The page older than a cursor, from the two halves the database is asked for
 * with plain filters: the cursor's own timestamp with a smaller id, and every
 * earlier timestamp. Each half is already limited to one page, so their
 * newest `limit` rows together are exactly the next page. Returned oldest
 * first, as the view shows them.
 */
export function olderPage<T extends Ordered>(
  sameInstant: T[],
  earlier: T[],
  cursor: Ordered,
  limit: number,
): T[] {
  return mergeMessages(sameInstant, earlier)
    .filter((message) => isOlderThan(message, cursor))
    .slice(-limit);
}
