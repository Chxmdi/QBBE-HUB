import { describe, expect, it, vi } from "vitest";
import { leafPaths } from "../i18n";
import { isObjectLocked } from "../lock";
import { collabEn } from "../messages.en";
import { collabFr } from "../messages.fr-CA";
import { createThrottle, initials, isCursor, orderPresence, type PresenceEntry } from "../presence";

const now = new Date("2026-10-01T12:00:00Z");
const entry = (userId: string, name: string, editing: boolean, secondsAgo = 5): PresenceEntry => ({
  userId,
  name,
  editing,
  cursor: null,
  updatedAt: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
});

describe("presence", () => {
  it("shows me first, then editors, then viewers by name, and drops stale rows", () => {
    const ordered = orderPresence(
      [entry("z", "Zoe", false), entry("me", "Me", false), entry("b", "Bea", true), entry("a", "Al", false), entry("old", "Old", true, 90)],
      "me",
      now,
    );
    expect(ordered.map((e) => e.userId)).toEqual(["me", "b", "a", "z"]);
  });

  it("builds initials from the first and last words", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("  marie-claire  de la tour ")).toBe("MT");
    expect(initials("Cher")).toBe("C");
    expect(initials("")).toBe("?");
  });

  it("accepts only well-formed cursors", () => {
    expect(isCursor({ blockId: "description", offset: 3 })).toBe(true);
    expect(isCursor({ blockId: "description", offset: 3, length: 2 })).toBe(true);
    expect(isCursor({ blockId: "description", offset: -1 })).toBe(false);
    expect(isCursor({ blockId: 1, offset: 0 })).toBe(false);
    expect(isCursor({ blockId: "x", offset: 1.5 })).toBe(false);
    expect(isCursor(null)).toBe(false);
  });

  it("throttles cursor moves but always delivers the last one", () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const send = createThrottle<number>((value) => sent.push(value), 1000, {
      now: () => Date.now(),
      set: (fn, ms) => setTimeout(fn, ms),
    });
    send(1);
    send(2);
    send(3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(1000);
    expect(sent).toEqual([1, 3]);
    vi.useRealTimers();
  });
});

describe("lock", () => {
  it("counts an unreadable lock as locked", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const db = { rpc } as unknown as Parameters<typeof isObjectLocked>[0];
    expect(await isObjectLocked(db, "x")).toBe(true);
    expect(await isObjectLocked(db, "x")).toBe(false);
    expect(await isObjectLocked(db, "x")).toBe(true);
  });
});

describe("collaboration text", () => {
  it("has every English key in French with the same placeholders", () => {
    const get = (node: unknown, path: string) =>
      path.split(".").reduce((value, key) => (value as Record<string, unknown>)[key], node) as string;
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(leafPaths(collabFr)).toEqual(leafPaths(collabEn));
    for (const path of leafPaths(collabEn)) {
      expect(get(collabFr, path).trim(), path).not.toBe("");
      expect(holes(get(collabFr, path)), path).toEqual(holes(get(collabEn, path)));
    }
  });
});
