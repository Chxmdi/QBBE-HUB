import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  calendarEventDeleteSucceeded,
  calendarLinkRecordFields,
} from "@/features/calendar/services/google-calendar-write";

describe("Google Calendar meeting cancellation", () => {
  it.each([200, 202, 204, 404])("treats %i as a terminal delete result", (status) => {
    expect(calendarEventDeleteSucceeded(status)).toBe(true);
  });

  it.each([400, 401, 403, 429, 500])("preserves the link for recovery on %i", (status) => {
    expect(calendarEventDeleteSucceeded(status)).toBe(false);
  });

  it("keeps Hub meeting and event links in distinct foreign-key columns", () => {
    expect(calendarLinkRecordFields({ kind: "meeting", id: "meeting-1" })).toEqual({
      meeting_id: "meeting-1",
    });
    expect(calendarLinkRecordFields({ kind: "event", id: "event-1" })).toEqual({
      event_id: "event-1",
    });
  });
});

describe("Calendar sync leaves the organizer's meeting link alone", () => {
  /**
   * CAL-005 requires `meeting_link` to be provider-agnostic. It was, until the
   * sync overwrote it with Google's `htmlLink` — the Calendar event page, not
   * a conferencing URL. A Zoom link typed by the organizer was replaced, and
   * "Join meeting" then opened Google.
   *
   * This reads the source because the defect *is* a write that should not
   * exist. There is no runtime state to inspect: the wrong behaviour was one
   * assignment, and its absence is the thing worth pinning. A behavioural test
   * would need a live Google connection, which is exactly why nothing caught
   * this for as long as it stood.
   */
  const source = readFileSync(
    join(process.cwd(), "src/features/meetings/services/meeting.commands.ts"),
    "utf8",
  );

  it("never writes meeting_link from a Google response", () => {
    const assignsFromGoogle = /meeting_link:\s*googleLink/.test(source);
    expect(assignsFromGoogle).toBe(false);
  });

  it("still stores the link the organizer typed", () => {
    // The create path must keep writing the user's own value, or this guard
    // would pass on a version that dropped the field altogether.
    expect(source).toMatch(/meeting_link:\s*meetingLink \|\| null/);
  });
});
