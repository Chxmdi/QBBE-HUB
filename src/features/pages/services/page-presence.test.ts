import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  othersOnPage,
  parsePresenceRows,
  PRESENCE_COLOURS,
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_TTL_MS,
  presenceColour,
  presenceInitials,
} from "./page-presence";
import { clearPageLive, readPageLive, subscribePageLive, updatePageLive } from "@/features/pages/live/presence-store";
import { pagesEn } from "@/features/pages/i18n/en";
import { pagesFrCA } from "@/features/pages/i18n/fr-CA";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const B = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const C = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

describe("page presence rules", () => {
  it("leaves the header within 30 s of a tab vanishing, and tolerates one lost heartbeat", () => {
    expect(PRESENCE_TTL_MS + PRESENCE_HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
    expect(PRESENCE_TTL_MS).toBeGreaterThanOrEqual(2 * PRESENCE_HEARTBEAT_MS);
  });

  it("gives each person the same colour every time, from the palette", () => {
    expect(presenceColour(A)).toBe(presenceColour(A));
    expect(PRESENCE_COLOURS).toContain(presenceColour(B));
    const spread = new Set(Array.from({ length: 40 }, (_, i) => presenceColour(`user-${i}`)));
    expect(spread.size).toBeGreaterThan(4);
  });

  it("uses colours that carry white text at 4.5:1 or more", () => {
    const css = readFileSync("src/design-system/styles/globals.css", "utf8");
    for (const colour of PRESENCE_COLOURS) {
      const name = /^var\((--color-avatar-\d+)\)$/.exec(colour)?.[1];
      expect(name, colour).toBeTruthy();
      const hex = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
      expect(hex, colour).toBeTruthy();
      expect(1.05 / (luminance(hex!) + 0.05), colour).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes initials from the first and last words", () => {
    expect(presenceInitials("QA Project Manager")).toBe("QM");
    expect(presenceInitials("élodie")).toBe("É");
    expect(presenceInitials("  ")).toBe("?");
  });

  it("reads rows defensively, one per person", () => {
    expect(parsePresenceRows(null)).toEqual([]);
    expect(
      parsePresenceRows([
        { user_id: A, full_name: "QA Owner", editing: true },
        { user_id: A, full_name: "Again", editing: false },
        { user_id: "not-a-uuid", full_name: "X", editing: true },
        { user_id: B, full_name: null, editing: "yes" },
      ]),
    ).toEqual([
      { userId: A, name: "QA Owner", editing: true },
      { userId: B, name: "", editing: false },
    ]);
  });

  it("shows others only, editors first, then by name", () => {
    const people = [
      { userId: A, name: "Me", editing: true },
      { userId: B, name: "Zed", editing: false },
      { userId: C, name: "Amy", editing: false },
      { userId: "d", name: "Bob", editing: true },
    ];
    expect(othersOnPage(people, A).map((p) => p.name)).toEqual(["Bob", "Amy", "Zed"]);
  });

  it("has the same strings in English and French", () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [k] : keys(v).map((s) => `${k}.${s}`)));
    expect(keys(pagesFrCA.units.c1)).toEqual(keys(pagesEn.units.c1));
    expect(keys(pagesEn.units.c1).length).toBeGreaterThan(5);
  });
});

describe("the page's shared live state", () => {
  it("tells subscribers about changes, and only about real ones", () => {
    const listener = vi.fn();
    const stop = subscribePageLive("page-1", listener);
    expect(readPageLive("page-1").me).toBeNull();
    const me = { userId: A, name: "QA Owner", colour: "#1d4ed8" };
    updatePageLive("page-1", { me });
    expect(readPageLive("page-1").me).toBe(me);
    expect(listener).toHaveBeenCalledTimes(1);
    updatePageLive("page-1", { me });
    updatePageLive("page-1", { livePeers: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    updatePageLive("page-1", { livePeers: [B] });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readPageLive("page-2").me).toBeNull();
    clearPageLive("page-1");
    expect(readPageLive("page-1").me).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    updatePageLive("page-1", { me });
    expect(listener).toHaveBeenCalledTimes(3);
    clearPageLive("page-1");
  });
});
