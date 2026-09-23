import { describe, expect, it } from "vitest";
import {
  DIGEST_ITEM_CAP,
  buildDigest,
  digestDedupeKey,
  digestSection,
  localDateString,
} from "@/features/notifications/services/digest";
import type { DigestItem } from "@/features/notifications/services/email-templates";

const item = (overrides: Partial<DigestItem> = {}): DigestItem => ({
  title: "Something happened",
  body: null,
  category: "assignment",
  link: "/my-work",
  createdAt: "2026-08-19T12:00:00Z",
  ...overrides,
});

describe("buildDigest", () => {
  it("returns null rather than an empty digest", () => {
    expect(buildDigest([])).toBeNull();
  });

  it("groups by category", () => {
    const digest = buildDigest([
      item({ category: "assignment", title: "A" }),
      item({ category: "mention", title: "B" }),
      item({ category: "assignment", title: "C" }),
    ]);

    expect(digest).not.toBeNull();
    expect(digest!.groups.map((group) => group.category)).toEqual([
      "assignment",
      "mention",
    ]);
    expect(digest!.groups[0].items).toHaveLength(2);
  });

  it("puts announcements ahead of routine updates", () => {
    const digest = buildDigest([
      item({ category: "system", title: "System" }),
      item({ category: "announcement", title: "Announcement" }),
      item({ category: "assignment", title: "Assignment" }),
    ]);

    expect(digest!.groups.map((group) => group.category)).toEqual([
      "announcement",
      "assignment",
      "system",
    ]);
  });

  it("orders newest first inside a category", () => {
    const digest = buildDigest([
      item({ title: "older", createdAt: "2026-08-18T09:00:00Z" }),
      item({ title: "newer", createdAt: "2026-08-19T09:00:00Z" }),
    ]);

    expect(digest!.groups[0].items.map((entry) => entry.title)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("caps the body and reports the remainder", () => {
    const many = Array.from({ length: 57 }, (_, index) =>
      item({ title: `Item ${index}` }),
    );
    const digest = buildDigest(many);

    expect(digest!.totalCount).toBe(57);
    expect(digest!.shownCount).toBe(DIGEST_ITEM_CAP);
    const rendered = digest!.groups.reduce(
      (count, group) => count + group.items.length,
      0,
    );
    expect(rendered).toBe(DIGEST_ITEM_CAP);
  });

  it("sorts unknown categories after the known ones", () => {
    const digest = buildDigest([
      item({ category: "something_new" }),
      item({ category: "assignment" }),
    ]);
    expect(digest!.groups[0].category).toBe("assignment");
    expect(digest!.groups[1].category).toBe("something_new");
  });

  it("groups by the five digest sections when those are set", () => {
    const digest = buildDigest([
      item({ title: "Chat", section: "activity" }),
      item({ title: "Soon", section: "upcoming" }),
      item({ title: "Late", section: "overdue" }),
    ]);
    expect(digest!.groups.map((group) => group.category)).toEqual([
      "overdue",
      "upcoming",
      "activity",
    ]);
  });
});

describe("digestSection", () => {
  it("puts due dates into overdue or upcoming", () => {
    expect(digestSection({ category: "due_date", title: "Due", dueOn: "2026-08-01" }, "2026-08-19")).toBe(
      "overdue",
    );
    expect(digestSection({ category: "due_date", title: "Due", dueOn: "2026-08-20" }, "2026-08-19")).toBe(
      "upcoming",
    );
  });

  it("classifies stale, meeting, and other work", () => {
    expect(digestSection({ category: "system", title: "Stale project" }, "2026-08-19")).toBe("stale");
    expect(digestSection({ category: "meeting", title: "Stand-up" }, "2026-08-19")).toBe("meetings");
    expect(digestSection({ category: "assignment", title: "Assigned" }, "2026-08-19")).toBe("activity");
  });
});

describe("digest identity", () => {
  it("keys one digest per person per local day", () => {
    expect(digestDedupeKey("user-1", "2026-08-19")).toBe("digest:user-1:2026-08-19");
  });

  it("uses the recipient's own calendar date", () => {
    // 03:00 UTC on the 20th is still the 19th in Toronto.
    const at = new Date("2026-08-20T03:00:00Z");
    expect(localDateString("America/Toronto", at)).toBe("2026-08-19");
    expect(localDateString("UTC", at)).toBe("2026-08-20");
  });

  it("falls back to the UTC date for an unknown zone", () => {
    const at = new Date("2026-08-20T03:00:00Z");
    expect(localDateString("Mars/Olympus", at)).toBe("2026-08-20");
  });
});
