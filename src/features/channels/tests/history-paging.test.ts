import { describe, expect, it } from "vitest";
import {
  compareMessages,
  isOlderThan,
  mergeMessages,
  olderPage,
} from "@/features/channels/history";

type Message = { id: string; created_at: string };

const PAGE = 100;

/**
 * 250 messages where timestamps repeat in runs of 7, as they do when history is
 * imported or written in one transaction, so page boundaries land inside runs.
 */
function history(): Message[] {
  return Array.from({ length: 250 }, (_, index) => ({
    id: `00000000-0000-0000-0000-${String(1000 + index * 37).padStart(12, "0")}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 9, 0, Math.floor(index / 7))).toISOString(),
  }));
}

/** What the database returns for one page: newest first, by the given filter. */
function page(all: Message[], older: (m: Message) => boolean): Message[] {
  return all.filter(older).sort((a, b) => compareMessages(b, a)).slice(0, PAGE).reverse();
}

/** Loads the newest page, then older pages until one comes back short. */
function scrollBack(all: Message[], loadOlder: (cursor: Message) => Message[]) {
  let shown = page(all, () => true);
  let hasOlder = shown.length >= PAGE;
  while (hasOlder) {
    const older = loadOlder(shown[0]);
    hasOlder = older.length >= PAGE;
    shown = mergeMessages(older, shown);
  }
  return shown;
}

/** The view's two queries, as the database answers them, combined by olderPage. */
const keyset = (all: Message[]) => (cursor: Message) =>
  olderPage(
    page(all, (m) => m.created_at === cursor.created_at && m.id < cursor.id),
    page(all, (m) => m.created_at < cursor.created_at),
    cursor,
    PAGE,
  );

describe("channel and DM history paging", () => {
  it("shows every message exactly once, in order, across page boundaries that split a timestamp", () => {
    const all = history();
    const shown = scrollBack(all, keyset(all));

    expect(shown).toHaveLength(all.length);
    expect(new Set(shown.map((m) => m.id)).size).toBe(all.length);
    expect(shown).toEqual([...all].sort(compareMessages));
  });

  it("loses messages with the timestamp-only cursor this replaces", () => {
    const all = history();
    const shown = scrollBack(all, (cursor) => page(all, (m) => m.created_at < cursor.created_at));
    expect(shown.length).toBeLessThan(all.length);
  });

  it("merges a refresh into what is shown without duplicating or reordering", () => {
    const [a, b, c] = history();
    expect(mergeMessages([a, b], [b, c])).toEqual([a, b, c]);
    expect(mergeMessages([c], [a, b])).toEqual([a, b, c]);
  });

  it("orders the same instant printed at different precisions as equal time", () => {
    const first = { id: "b", created_at: "2026-01-01T09:00:00+00:00" };
    const second = { id: "a", created_at: "2026-01-01T09:00:00.000001+00:00" };
    expect(compareMessages(first, { id: "z", created_at: "2026-01-01T09:00:01+00:00" })).toBeLessThan(0);
    expect(Math.sign(compareMessages(first, second))).not.toBe(0);
  });

  it("never returns the cursor itself or anything newer", () => {
    const all = history();
    const cursor = all[120];
    const older = keyset(all)(cursor);
    expect(older).toHaveLength(PAGE);
    expect(older.every((m) => isOlderThan(m, cursor))).toBe(true);
    expect(older.at(-1)).toEqual(all[119]);
  });
});
