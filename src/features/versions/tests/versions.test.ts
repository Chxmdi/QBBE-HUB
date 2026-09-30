import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { leafPaths } from "@/features/collab/i18n";
import { isContentSnapshot } from "../content";
import { versionsEn } from "../messages.en";
import { versionsFr } from "../messages.fr-CA";
import { daysLeft, TRASH_DAYS } from "../trash";
import { contentAdapterFor } from "../adapters/registry";

const MIGRATION = readFileSync("supabase/migrations/20261103110200_object_versions_and_trash.sql", "utf8");

describe("content snapshots", () => {
  it("accepts the block format and rejects anything else", () => {
    expect(isContentSnapshot({ version: 1, blocks: [] })).toBe(true);
    expect(isContentSnapshot({ version: 1, blocks: [{ id: "a", type: "paragraph", text: "hi" }] })).toBe(true);
    expect(isContentSnapshot({ version: 2, blocks: [] })).toBe(false);
    expect(isContentSnapshot({ version: 1, blocks: [{ id: "a", type: "paragraph" }] })).toBe(false);
    expect(isContentSnapshot({ version: 1, blocks: [null] })).toBe(false);
    expect(isContentSnapshot("text")).toBe(false);
  });

  it("has an adapter for tasks only until the editor lands", () => {
    expect(contentAdapterFor("task")).not.toBeNull();
    expect(contentAdapterFor("page")).toBeNull();
  });
});

describe("the trash", () => {
  it("keeps things as long as the database does", () => {
    expect(MIGRATION).toContain(`now() + interval '${TRASH_DAYS} days'`);
  });

  it("counts whole days left, and zero on the last day", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(daysLeft("2026-10-31T12:00:00Z", now)).toBe(30);
    expect(daysLeft("2026-10-02T11:00:00Z", now)).toBe(0);
    expect(daysLeft("2026-09-01T00:00:00Z", now)).toBe(0);
  });
});

describe("versions text", () => {
  it("has every English key in French with the same placeholders", () => {
    const en = leafPaths(versionsEn);
    expect(leafPaths(versionsFr)).toEqual(en);
    const get = (node: unknown, path: string) =>
      path.split(".").reduce((value, key) => (value as Record<string, unknown>)[key], node) as string;
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const path of en) {
      expect(get(versionsFr, path).trim(), path).not.toBe("");
      expect(holes(get(versionsFr, path)), path).toEqual(holes(get(versionsEn, path)));
    }
  });
});
