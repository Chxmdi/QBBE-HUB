import { describe, expect, it } from "vitest";
import { composeMeetingSummary } from "@/features/meetings/services/meeting.summary";

/**
 * P0-MTG-03 lists what a completed meeting must produce. The attendees line
 * was absent for as long as attendees could not be invited at all — the
 * requirement and the gap had the same root, so these pin the content rather
 * than trusting a reading of the action.
 */

const base = {
  title: "Programme review",
  attendees: [],
  decisions: [],
  actions: [],
};

describe("a meeting summary says who was there", () => {
  it("lists attendees alphabetically", () => {
    const summary = composeMeetingSummary({
      ...base,
      attendees: [
        { fullName: "Zora Neale" },
        { fullName: "Amara Osei" },
        { fullName: "Kwame Boateng" },
      ],
    });
    expect(summary).toContain("Attendees: Amara Osei, Kwame Boateng, Zora Neale");
  });

  it("says so plainly when nobody was recorded", () => {
    // "none recorded" distinguishes an undocumented meeting from one whose
    // summary simply omitted the section.
    expect(composeMeetingSummary(base)).toContain("Attendees: none recorded");
  });

  it("skips an attendee whose profile carries no name", () => {
    const summary = composeMeetingSummary({
      ...base,
      attendees: [{ fullName: "Amara Osei" }, { fullName: null }],
    });
    expect(summary).toContain("Attendees: Amara Osei");
    expect(summary).not.toContain(", null");
  });
});

describe("the rest of the summary is unchanged by the attendees line", () => {
  it("keeps decisions and actions with owners and due dates", () => {
    const summary = composeMeetingSummary({
      ...base,
      attendees: [{ fullName: "Amara Osei" }],
      decisions: [{ title: "Approve the autumn budget" }],
      actions: [
        { title: "Draft the funder note", ownerName: "Kwame Boateng", dueAt: "2026-09-30" },
        { title: "Book the venue", ownerName: null, dueAt: null },
      ],
    });
    expect(summary).toContain("Decisions:\n• Approve the autumn budget");
    expect(summary).toContain("• Draft the funder note — Kwame Boateng (due 2026-09-30)");
    expect(summary).toContain("• Book the venue");
  });

  it("names every required section even when the meeting produced nothing", () => {
    const summary = composeMeetingSummary(base);
    expect(summary).toContain("Meeting summary — Programme review");
    expect(summary).toContain("Attendees: none recorded");
    expect(summary).toContain("Decisions: none recorded");
    expect(summary).toContain("Actions: none recorded");
  });
});
