import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  decideDelivery,
  hourIn,
  inQuietWindow,
  isDigestHour,
  isMandatory,
  secondsUntilQuietEnds,
  withPreferenceDefaults,
  type DeliveryPreferences,
} from "@/features/notifications/services/delivery-rules";

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
});
