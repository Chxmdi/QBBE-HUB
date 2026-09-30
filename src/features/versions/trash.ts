/** How long a deleted object stays restorable (matches trash_object). */
export const TRASH_DAYS = 30;

/** Whole days left before a trashed item is purged; 0 on its last day. */
export function daysLeft(purgeAfter: string, now: Date = new Date()): number {
  const ms = new Date(purgeAfter).getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
