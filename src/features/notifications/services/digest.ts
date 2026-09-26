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
  "overdue",
  "upcoming",
  "meetings",
  "stale",
  "activity",
  "announcement",
  "assignment",
  "approval",
  "decision",
  "due_date",
  "mention",
  "reply",
  "system",
];

/**
 * Which digest section a notification belongs in.
 *
 * `today` is the recipient's calendar date (YYYY-MM-DD). Due dates on or
 * after it are upcoming; earlier ones are overdue.
 */
export function digestSection(
  item: { category: string; title: string; dueOn?: string | null },
  today: string,
): string {
  if (item.category === "due_date") {
    if (item.dueOn && item.dueOn < today) return "overdue";
    return "upcoming";
  }
  if (item.category === "system" && /stale|no activity/i.test(item.title)) return "stale";
  if (item.category === "meeting") return "meetings";
  return "activity";
}

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

  const groupedBySection = items.some((item) => item.section);
  const groupOf = (item: DigestItem) =>
    groupedBySection ? item.section || "activity" : item.category;

  const ordered = [...items].sort((a, b) => {
    const rank = categoryRank(groupOf(a)) - categoryRank(groupOf(b));
    if (rank !== 0) return rank;
    const left = groupOf(a);
    const right = groupOf(b);
    if (left !== right) return left.localeCompare(right);
    return b.createdAt.localeCompare(a.createdAt);
  });

  const shown = ordered.slice(0, Math.max(1, cap));

  const groups: { category: string; items: DigestItem[] }[] = [];
  for (const item of shown) {
    const key = groupOf(item);
    const last = groups[groups.length - 1];
    if (last && last.category === key) last.items.push(item);
    else groups.push({ category: key, items: [item] });
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
