import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  decideDelivery,
  hourIn,
  inQuietWindow,
  isDigestDue,
  isDigestHour,
  isMandatory,
  secondsUntilQuietEnds,
  withPreferenceDefaults,
  type DeliveryPreferences,
} from "@/features/notifications/services/delivery-rules";
import { channelMuteAllows, inboxItemVisible } from "@/features/notifications/services/mute";

/**
 * These rules decide whether a person is interrupted, so the tests are written
 * as claims about behaviour rather than about implementation: what always
 * arrives, what never does, and what is merely delayed.
 */

const prefs = (overrides: Partial<DeliveryPreferences> = {}): DeliveryPreferences => ({
  ...DEFAULT_PREFERENCES,
  ...overrides,
});

// 02:00 in Toronto on a summer night — squarely inside a 22→07 quiet window.
const NIGHT = new Date("2026-08-19T06:00:00Z");
// 14:00 in Toronto.
const AFTERNOON = new Date("2026-08-19T18:00:00Z");

const EMAIL = "person@example.org";

describe("mandatory categories", () => {
  it("treats security notices as mandatory", () => {
    expect(isMandatory({ category: "security", urgency: "low" })).toBe(true);
  });

  it("treats high and critical announcements as mandatory", () => {
    expect(isMandatory({ category: "announcement", urgency: "high" })).toBe(true);
    expect(isMandatory({ category: "announcement", urgency: "critical" })).toBe(true);
  });

  it("does not treat a routine announcement as mandatory", () => {
    expect(isMandatory({ category: "announcement", urgency: "normal" })).toBe(false);
  });

  it("does not treat ordinary urgent work as mandatory", () => {
    expect(isMandatory({ category: "assignment", urgency: "critical" })).toBe(false);
  });
});

describe("quiet windows", () => {
  it("recognises a window that wraps midnight", () => {
    const p = prefs({ quiet_hours_start: 22, quiet_hours_end: 7 });
    expect(hourIn(p.timezone, NIGHT)).toBe(2);
    expect(inQuietWindow(p, NIGHT)).toBe(true);
    expect(inQuietWindow(p, AFTERNOON)).toBe(false);
  });

  it("recognises a window inside one day", () => {
    const p = prefs({ quiet_hours_start: 12, quiet_hours_end: 16 });
    expect(inQuietWindow(p, AFTERNOON)).toBe(true);
    expect(inQuietWindow(p, NIGHT)).toBe(false);
  });

  it("treats equal ends as no window at all", () => {
    const p = prefs({ quiet_hours_start: 9, quiet_hours_end: 9 });
    expect(inQuietWindow(p, NIGHT)).toBe(false);
    expect(inQuietWindow(p, AFTERNOON)).toBe(false);
  });

  it("treats an unset window as no window", () => {
    expect(inQuietWindow(prefs(), NIGHT)).toBe(false);
  });

  it("computes a delay that lands after the window ends", () => {
    const p = prefs({ quiet_hours_start: 22, quiet_hours_end: 7 });
    const delay = secondsUntilQuietEnds(p, NIGHT);
    // 02:00 local to 07:00 local is five hours.
    expect(delay).toBeGreaterThan(4 * 3600);
    expect(delay).toBeLessThanOrEqual(5 * 3600 + 60);

    const released = new Date(NIGHT.getTime() + delay * 1000);
    expect(inQuietWindow(p, released)).toBe(false);
  });

  it("never returns a zero delay while still inside the window", () => {
    const p = prefs({ quiet_hours_start: 22, quiet_hours_end: 7 });
    // 06:59 local, one minute from the end.
    const almostOut = new Date("2026-08-19T10:59:00Z");
    expect(inQuietWindow(p, almostOut)).toBe(true);
    expect(secondsUntilQuietEnds(p, almostOut)).toBeGreaterThanOrEqual(60);
  });

  it("falls back to UTC for an unknown zone rather than throwing", () => {
    expect(() => hourIn("Mars/Olympus", NIGHT)).not.toThrow();
    expect(hourIn("Mars/Olympus", NIGHT)).toBe(NIGHT.getUTCHours());
  });
});

describe("decideDelivery", () => {
  it("sends a routine notification outside quiet hours", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "normal" },
      prefs({ email_critical: false }),
      AFTERNOON,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("defers routine mail during quiet hours instead of dropping it", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "normal" },
      prefs({ quiet_hours_start: 22, quiet_hours_end: 7, email_critical: false }),
      NIGHT,
      EMAIL,
    );
    expect(decision.action).toBe("defer");
    if (decision.action === "defer") {
      expect(decision.delaySeconds).toBeGreaterThan(0);
      expect(decision.reason).toBe("quiet-hours");
    }
  });

  it("delivers a critical announcement during quiet hours", () => {
    const decision = decideDelivery(
      { category: "announcement", urgency: "critical" },
      prefs({ quiet_hours_start: 22, quiet_hours_end: 7 }),
      NIGHT,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("delivers a security notice even with every switch off", () => {
    const decision = decideDelivery(
      { category: "security", urgency: "low" },
      prefs({
        email_critical: false,
        email_digest: true,
        email_assignments: false,
        email_mentions: false,
        email_announcements: false,
        email_due_dates: false,
        quiet_hours_start: 0,
        quiet_hours_end: 23,
      }),
      NIGHT,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("delivers a required announcement even when announcements are switched off", () => {
    const decision = decideDelivery(
      { category: "announcement", urgency: "high" },
      prefs({ email_announcements: false, quiet_hours_start: 22, quiet_hours_end: 7 }),
      NIGHT,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("suppresses a category the recipient switched off", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "normal" },
      prefs({ email_assignments: false }),
      AFTERNOON,
      EMAIL,
    );
    expect(decision).toEqual({
      action: "suppress",
      reason: "preference:email_assignments",
    });
  });

  it("routes low-urgency items to the digest when one is subscribed", () => {
    const decision = decideDelivery(
      { category: "system", urgency: "low" },
      prefs({ email_digest: true }),
      AFTERNOON,
      EMAIL,
    );
    expect(decision).toEqual({
      action: "suppress",
      reason: "low-urgency-digest-only",
    });
  });

  it("reaches someone urgently when they asked to be reached urgently", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "critical" },
      prefs({ email_critical: true, quiet_hours_start: 22, quiet_hours_end: 7 }),
      NIGHT,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("holds urgent work until morning when they did not", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "critical" },
      prefs({ email_critical: false, quiet_hours_start: 22, quiet_hours_end: 7 }),
      NIGHT,
      EMAIL,
    );
    expect(decision.action).toBe("defer");
  });

  it("suppresses when there is no address to send to", () => {
    expect(
      decideDelivery({ category: "security", urgency: "critical" }, prefs(), NIGHT, null),
    ).toEqual({ action: "suppress", reason: "no-email-address" });

    expect(
      decideDelivery(
        { category: "assignment", urgency: "normal" },
        prefs(),
        AFTERNOON,
        "not-an-address",
      ),
    ).toEqual({ action: "suppress", reason: "no-email-address" });
  });
});

describe("digest scheduling", () => {
  it("fires only at the recipient's own local hour", () => {
    const p = prefs({ email_digest: true, digest_hour: 8, timezone: "America/Toronto" });
    // 08:00 in Toronto during daylight saving is 12:00 UTC.
    expect(isDigestHour(p, new Date("2026-08-19T12:00:00Z"))).toBe(true);
    expect(isDigestHour(p, new Date("2026-08-19T13:00:00Z"))).toBe(false);
  });

  it("stays correct across a daylight-saving change", () => {
    const p = prefs({ email_digest: true, digest_hour: 8, timezone: "America/Toronto" });
    // 08:00 in Toronto in January is 13:00 UTC.
    expect(isDigestHour(p, new Date("2026-01-19T13:00:00Z"))).toBe(true);
    expect(isDigestHour(p, new Date("2026-01-19T12:00:00Z"))).toBe(false);
  });

  it("never fires for someone who has not subscribed", () => {
    const p = prefs({ email_digest: false, digest_hour: 8 });
    expect(isDigestHour(p, new Date("2026-08-19T12:00:00Z"))).toBe(false);
  });
});

describe("withPreferenceDefaults", () => {
  it("fills a missing row with the documented defaults", () => {
    expect(withPreferenceDefaults(null)).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps the stored values it is given", () => {
    const merged = withPreferenceDefaults({ email_digest: true, digest_hour: 6 });
    expect(merged.email_digest).toBe(true);
    expect(merged.digest_hour).toBe(6);
    expect(merged.email_assignments).toBe(true);
  });

  it("treats a missing mute list as nothing muted", () => {
    const merged = withPreferenceDefaults({ muted_project_ids: undefined });
    expect(merged.muted_project_ids).toEqual([]);
    expect(merged.category_modes).toEqual({});
  });
});

const PROJECT = "11111111-1111-1111-1111-111111111111";

describe("category modes and mutes", () => {
  it("holds a weekly category out of immediate mail, even when the work is urgent", () => {
    const decision = decideDelivery(
      { category: "assignment", urgency: "critical" },
      prefs({
        category_modes: { assignment: "weekly" },
        email_critical: true,
      }),
      AFTERNOON,
      EMAIL,
    );
    expect(decision).toEqual({ action: "suppress", reason: "digest-only:weekly" });
  });

  it("holds a daily category the same way", () => {
    const decision = decideDelivery(
      { category: "mention", urgency: "normal" },
      prefs({ category_modes: { mention: "daily" } }),
      AFTERNOON,
      EMAIL,
    );
    expect(decision).toEqual({ action: "suppress", reason: "digest-only:daily" });
  });

  it("still sends a required notice when that project is muted", () => {
    const decision = decideDelivery(
      { category: "security", urgency: "low", projectId: PROJECT },
      prefs({ muted_project_ids: [PROJECT], category_modes: { assignment: "off" } }),
      NIGHT,
      EMAIL,
    );
    expect(decision).toEqual({ action: "send" });
  });

  it("suppresses ordinary mail for a muted project or thread", () => {
    const muted = prefs({ muted_project_ids: [PROJECT], muted_thread_ids: ["thread-1"] });
    expect(
      decideDelivery(
        { category: "assignment", urgency: "normal", projectId: PROJECT },
        muted,
        AFTERNOON,
        EMAIL,
      ),
    ).toEqual({ action: "suppress", reason: "muted-project" });
    expect(
      decideDelivery(
        { category: "reply", urgency: "normal", threadId: "thread-1" },
        muted,
        AFTERNOON,
        EMAIL,
      ),
    ).toEqual({ action: "suppress", reason: "muted-thread" });
  });

  it("sends a weekly digest only on the chosen weekday", () => {
    const weekly = prefs({
      digest_hour: 14,
      digest_weekday: 3,
      category_modes: { assignment: "weekly" },
      timezone: "America/Toronto",
    });
    // 14:00 in Toronto on Wednesday 19 Aug 2026.
    expect(isDigestDue(weekly, AFTERNOON)).toBe(true);
    expect(isDigestDue(weekly, new Date("2026-08-18T18:00:00Z"))).toBe(false);
  });
});

describe("inbox and channel mute", () => {
  it("hides a muted project in the inbox and keeps a required announcement", () => {
    expect(
      inboxItemVisible({
        category: "assignment",
        urgency: "normal",
        projectId: PROJECT,
        mutedProjectIds: [PROJECT],
        mutedThreadIds: [],
      }),
    ).toBe(false);
    expect(
      inboxItemVisible({
        category: "announcement",
        urgency: "critical",
        projectId: PROJECT,
        mutedProjectIds: [PROJECT],
        mutedThreadIds: [],
      }),
    ).toBe(true);
  });

  it("drops a reply when the channel is set to mentions only", () => {
    expect(channelMuteAllows("mentions", "mention")).toBe(true);
    expect(channelMuteAllows("mentions", "reply")).toBe(false);
    expect(channelMuteAllows("muted", "mention")).toBe(false);
    expect(channelMuteAllows("all", "reply")).toBe(true);
  });
});
