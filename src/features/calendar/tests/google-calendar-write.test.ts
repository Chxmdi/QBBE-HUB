import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarEventDeleteSucceeded,
  calendarExternalId,
  calendarLinkRecordFields,
  createOrRecoverGoogleCalendarEvent,
} from "@/features/calendar/services/google-calendar-write";

afterEach(() => vi.unstubAllGlobals());

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

describe("Hub-owned Calendar write idempotency", () => {
  it("derives a stable provider id from the Hub record", () => {
    const first = calendarExternalId({ kind: "meeting", id: "11111111-1111-1111-1111-111111111111" });
    const again = calendarExternalId({ kind: "meeting", id: "11111111-1111-1111-1111-111111111111" });
    const event = calendarExternalId({ kind: "event", id: "11111111-1111-1111-1111-111111111111" });
    expect(first).toBe(again);
    expect(first).not.toBe(event);
    expect(first).toMatch(/^qbbe[0-9a-f]{48}$/);
  });

  it("converges a duplicate create retry by PATCHing the deterministic event", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "qbbe123",
        htmlLink: "https://calendar.google.com/event",
        updated: "2026-09-24T05:00:00Z",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createOrRecoverGoogleCalendarEvent(
      "token",
      "qbbe123",
      {
        summary: "Board meeting",
        start: { dateTime: "2026-11-01T14:00:00.000Z" },
        end: { dateTime: "2026-11-01T15:00:00.000Z" },
      },
    );

    expect(result.id).toBe("qbbe123");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PATCH" });
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain("/events/qbbe123");
  });

  it("does not retry permanent provider rejections as a conflict recovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOrRecoverGoogleCalendarEvent(
      "token",
      "qbbe123",
      {
        summary: "Board meeting",
        start: { dateTime: "2026-11-01T14:00:00.000Z" },
        end: { dateTime: "2026-11-01T15:00:00.000Z" },
      },
    )).rejects.toThrow("rejected the event (403)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
