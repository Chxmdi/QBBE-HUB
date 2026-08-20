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
