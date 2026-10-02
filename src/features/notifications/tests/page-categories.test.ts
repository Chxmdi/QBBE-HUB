import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HUB_CATEGORIES,
  hubAllows,
  hubCategoryOf,
  hubMutedFromForm,
  normalizeHubMuted,
  PAGE_EMAIL_CATEGORIES,
} from "@/features/notifications/categories";
import {
  decideDelivery,
  withPreferenceDefaults,
  type DeliveryMode,
} from "@/features/notifications/services/delivery-rules";
import { pagesEn } from "@/features/pages/i18n/en";
import { pagesFrCA } from "@/features/pages/i18n/fr-CA";

const NOON = new Date("2026-10-02T16:00:00Z");

function decide(category: string, modes: Record<string, DeliveryMode>) {
  return decideDelivery(
    { category, urgency: "normal" },
    withPreferenceDefaults({ category_modes: modes }),
    NOON,
    "person@example.org",
  );
}

/** Every leaf key of a nested string catalogue. */
function keys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keys(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("C3-3: notification preference categories", () => {
  it("offers mentions, assigned work, comments, approvals and watched pages", () => {
    expect([...HUB_CATEGORIES]).toEqual(["mention", "assignment", "comment", "approval", "watched_page"]);
    expect([...PAGE_EMAIL_CATEGORIES]).toEqual(["comment", "approval", "watched_page"]);
  });

  it.each(HUB_CATEGORIES)("honours the email choice for %s", (category) => {
    expect(decide(category, { [category]: "off" })).toEqual({ action: "suppress", reason: `preference:${category}` });
    expect(decide(category, { [category]: "daily" })).toEqual({ action: "suppress", reason: "digest-only:daily" });
    expect(decide(category, { [category]: "weekly" })).toEqual({ action: "suppress", reason: "digest-only:weekly" });
    expect(decide(category, { [category]: "immediate" })).toEqual({ action: "send" });
  });

  it("keeps one category's email choice from leaking into another", () => {
    expect(decide("watched_page", { comment: "off" })).toEqual({ action: "send" });
    expect(decide("comment", { watched_page: "off" })).toEqual({ action: "send" });
    // Approvals followed assigned work until they had their own choice.
    expect(decide("approval", { assignment: "off" })).toEqual({ action: "suppress", reason: "preference:approval" });
    expect(decide("approval", { assignment: "off", approval: "immediate" })).toEqual({ action: "send" });
  });

  it("maps notification categories to the preference that mutes them, as the database does", () => {
    expect(hubCategoryOf("mention")).toBe("mention");
    expect(hubCategoryOf("reply")).toBe("mention");
    for (const category of ["assignment", "comment", "approval", "watched_page"]) {
      expect(hubCategoryOf(category)).toBe(category);
    }
    for (const category of ["security", "announcement", "due_date", "system", "follow_comment"]) {
      expect(hubCategoryOf(category)).toBeNull();
    }
    // The same list as app.notification_hub_key and the column's check.
    const migration = readFileSync("supabase/migrations/20261110040000_page_watch.sql", "utf8");
    expect(migration).toContain(
      "array['mention', 'assignment', 'comment', 'approval', 'watched_page']::text[]",
    );
    expect(migration).toContain("when p_category in ('mention', 'reply') then 'mention'");
    expect(migration).toContain("when p_category in ('assignment', 'comment', 'approval', 'watched_page') then p_category");
  });

  it("drops only the muted categories, never security notices or announcements", () => {
    const muted = ["watched_page", "mention"];
    expect(hubAllows("watched_page", muted)).toBe(false);
    expect(hubAllows("mention", muted)).toBe(false);
    expect(hubAllows("reply", muted)).toBe(false);
    expect(hubAllows("comment", muted)).toBe(true);
    expect(hubAllows("security", [...HUB_CATEGORIES])).toBe(true);
    expect(hubAllows("announcement", [...HUB_CATEGORIES])).toBe(true);
  });

  it("reads the muted list from the form's unticked In the Hub boxes", () => {
    const form = new Map<string, string>([
      ["hub_mention", "on"],
      ["hub_assignment", "on"],
      ["hub_approval", "on"],
    ]);
    expect(hubMutedFromForm({ get: (name: string) => form.get(name) ?? null })).toEqual(["comment", "watched_page"]);
    expect(hubMutedFromForm({ get: () => "on" })).toEqual([]);
  });

  it("cleans a stored list", () => {
    expect(normalizeHubMuted(["watched_page", "nonsense", "mention", "mention"])).toEqual(["mention", "watched_page"]);
    expect(normalizeHubMuted(null)).toEqual([]);
  });

  it("has every C3 string in English and Québec French, with the same keys", () => {
    expect(keys(pagesFrCA.units.c3).sort()).toEqual(keys(pagesEn.units.c3).sort());
    for (const category of PAGE_EMAIL_CATEGORIES) {
      expect(pagesFrCA.units.c3.preferences.categories[category].label).not.toBe(
        pagesEn.units.c3.preferences.categories[category].label,
      );
    }
  });
});
