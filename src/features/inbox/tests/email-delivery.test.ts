import { describe, expect, it } from "vitest";
import {
  alreadyDelivered,
  deliveryDedupeKey,
  shouldQueueEmail,
} from "@/features/inbox/services/email-delivery";

const assignment = {
  id: "n1",
  category: "assignment",
  urgency: "normal",
  title: "You were assigned a task",
  body: "Prep workshop",
};

const requiredAnnouncement = {
  id: "n2",
  category: "announcement",
  urgency: "critical",
  title: "Required: safety briefing",
  body: "Please acknowledge",
};

describe("shouldQueueEmail", () => {
  it("queues critical categories by default", () => {
    expect(shouldQueueEmail(assignment, null)).toBe(true);
  });

  it("honors a preference that turns off non-required mail", () => {
    expect(shouldQueueEmail(assignment, { email_critical: false })).toBe(false);
  });

  it("cannot fully suppress required announcements", () => {
    expect(
      shouldQueueEmail(requiredAnnouncement, { email_critical: false }),
    ).toBe(true);
  });

  it("ignores informational categories", () => {
    expect(
      shouldQueueEmail(
        { ...assignment, category: "reply" },
        { email_critical: true },
      ),
    ).toBe(false);
  });
});

describe("delivery dedupe", () => {
  it("prevents a second email row for the same notification", () => {
    const key = deliveryDedupeKey("n1");
    const existing = new Set([key]);
    expect(alreadyDelivered(existing, "n1")).toBe(true);
    expect(alreadyDelivered(existing, "n2")).toBe(false);
  });
});
