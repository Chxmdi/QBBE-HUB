/**
 * Digest assembly.
 *
 * Pure, so the grouping and capping rules are testable without a database.
 * Three rules matter and all three are here:
 *
 *   - group by category, in a fixed order, so the same email reads the same
 *     way every morning;
 *   - cap the body and report the remainder, so a busy week does not produce
 *     a scroll of two hundred rows;
 *   - return null when there is nothing to say. An empty digest is worse than
 *     no digest: it teaches people that mail from the Hub can be ignored.
 */

import type { DigestItem } from "./email-templates";

/** Most actionable first. Anything unlisted sorts after these, alphabetically. */
export const DIGEST_CATEGORY_ORDER = [
  "announcement",
  "assignment",
  "approval",
  "due_date",
  "mention",
  "reply",
  "system",
];

export const DIGEST_ITEM_CAP = 20;

export interface DigestContent {
  groups: { category: string; items: DigestItem[] }[];
  totalCount: number;
  shownCount: number;
}

function categoryRank(category: string): number {
  const index = DIGEST_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? DIGEST_CATEGORY_ORDER.length : index;
}

/**
 * Groups and caps a person's unread notifications. Returns null when the
 * digest would be empty.
 */
export function buildDigest(
  items: DigestItem[],
  cap: number = DIGEST_ITEM_CAP,
): DigestContent | null {
  if (items.length === 0) return null;

  const ordered = [...items].sort((a, b) => {
    const rank = categoryRank(a.category) - categoryRank(b.category);
    if (rank !== 0) return rank;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    // Newest first inside a category.
    return b.createdAt.localeCompare(a.createdAt);
  });

  const shown = ordered.slice(0, Math.max(1, cap));

  const groups: { category: string; items: DigestItem[] }[] = [];
  for (const item of shown) {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.items.push(item);
    else groups.push({ category: item.category, items: [item] });
  }

  return { groups, totalCount: items.length, shownCount: shown.length };
}

/** One digest per person per local day — the key that makes it exactly-once. */
export function digestDedupeKey(userId: string, localDate: string): string {
  return `digest:${userId}:${localDate}`;
}

/** The recipient's own calendar date, which is what "today's digest" means. */
export function localDateString(timezone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}
