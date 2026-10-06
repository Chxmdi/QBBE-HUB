import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const ORGANIZER = "66666666-6666-4666-8666-666666666666";
const MEETING = "77777777-7777-4777-8777-777777777777";

let tableCalls: TableCall[] = [];
let answer: (call: TableCall) => Answer;
let isAdmin = false;
const updateGoogleMeetingEvent = vi.fn();
const deleteGoogleMeetingEvent = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ userId: ME, organizationId: ORG, timeZone: "America/Toronto", isAdmin }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/access-capabilities", () => ({ hasProjectCapability: async () => true }));
vi.mock("@/features/calendar/services/google-calendar-write", () => ({
  createGoogleMeetingEvent: async () => undefined,
  updateGoogleMeetingEvent: (...a: unknown[]) => updateGoogleMeetingEvent(...a),
  deleteGoogleMeetingEvent: (...a: unknown[]) => deleteGoogleMeetingEvent(...a),
  calendarFailureStatus: () => "degraded",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { createMeeting, updateMeeting, cancelMeeting } = await import("../services/meeting.commands");

/** `allowed` is what row-level security decides; the app's own check may differ. */
function db({ organizer = ME, status = "scheduled", allowed = true } = {}) {
  return (call: TableCall): Answer => {
    if (call.table === "meeting" && call.action === "select") return { data: { id: MEETING, organizer_id: organizer, status }, error: null };
    if (call.table === "meeting" && call.action === "update") return { data: allowed ? [{ id: MEETING }] : [], error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls = [];
  isAdmin = false;
  answer = db();
});

describe("updateMeeting", () => {
  const edit = { meetingId: MEETING, title: "Board", startsAt: "2026-11-10T18:00", durationMinutes: 90 };

  it("reschedules in the organization's time zone and updates the organizer's calendar", async () => {
    expect(await updateMeeting(edit)).toEqual({ ok: true, id: MEETING });
    const update = tableCalls.find((c) => c.table === "meeting" && c.action === "update");
    expect(update?.payload).toMatchObject({ starts_at: "2026-11-10T23:00:00.000Z", ends_at: "2026-11-11T00:30:00.000Z" });
    expect(updateGoogleMeetingEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: ME, meetingId: MEETING }));
  });

  it("refuses someone who is neither organizer nor admin before writing", async () => {
    answer = db({ organizer: ORGANIZER });
    expect(await updateMeeting(edit)).toEqual({ ok: false, error: "Only the organizer or an admin can reschedule this meeting." });
    expect(tableCalls.some((c) => c.action === "update")).toBe(false);
  });

  it("when the database refuses the change, says so and leaves the calendar alone", async () => {
    isAdmin = true;
    answer = db({ organizer: ORGANIZER, allowed: false });
    expect(await updateMeeting(edit)).toEqual({ ok: false, error: "Only the organizer or an admin can reschedule this meeting." });
    expect(updateGoogleMeetingEvent).not.toHaveBeenCalled();
  });

  it("refuses a finished or cancelled meeting and an impossible start", async () => {
    answer = db({ status: "completed" });
    expect((await updateMeeting(edit)).ok).toBe(false);
    answer = db();
    expect((await updateMeeting({ ...edit, startsAt: "2026-02-30T10:00" })).ok).toBe(false);
    expect((await updateMeeting({ ...edit, durationMinutes: 5 })).ok).toBe(false);
    expect(updateGoogleMeetingEvent).not.toHaveBeenCalled();
  });
});

describe("cancelMeeting", () => {
  it("cancels, clears the meeting link and removes the calendar event", async () => {
    expect(await cancelMeeting({ meetingId: MEETING })).toEqual({ ok: true, id: MEETING });
    const update = tableCalls.find((c) => c.table === "meeting" && c.action === "update");
    expect(update?.payload).toEqual({ status: "cancelled", meeting_link: null });
    expect(deleteGoogleMeetingEvent).toHaveBeenCalledWith({ organizationId: ORG, userId: ME, meetingId: MEETING });
  });

  it("when the database refuses an admin's cancel, keeps the organizer's calendar event", async () => {
    isAdmin = true;
    answer = db({ organizer: ORGANIZER, allowed: false });
    expect(await cancelMeeting({ meetingId: MEETING })).toEqual({ ok: false, error: "Only the organizer or an admin can cancel this meeting." });
    expect(deleteGoogleMeetingEvent).not.toHaveBeenCalled();
  });

  it("treats a second cancel as done and refuses a completed meeting", async () => {
    answer = db({ status: "cancelled" });
    expect(await cancelMeeting({ meetingId: MEETING })).toEqual({ ok: true, id: MEETING });
    answer = db({ status: "completed" });
    expect((await cancelMeeting({ meetingId: MEETING })).ok).toBe(false);
    expect(deleteGoogleMeetingEvent).not.toHaveBeenCalled();
  });

  it("keeps the cancellation and marks the connection when the calendar removal fails", async () => {
    deleteGoogleMeetingEvent.mockRejectedValueOnce(new Error("Google down"));
    expect((await cancelMeeting({ meetingId: MEETING })).ok).toBe(true);
    const marked = tableCalls.find((c) => c.table === "integration_connection" && c.action === "update");
    expect(marked?.payload).toMatchObject({ status: "degraded", last_error: "Google down" });
  });
});

describe("createMeeting meeting link", () => {
  const base = { title: "Board", startsAt: "2026-11-10T18:00" };
  const refused = "Use a meeting link that starts with https://.";

  it.each(["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "http://meet.example.org/board"])(
    "refuses %s before anything is saved (staging audit S5)",
    async (meetingLink) => {
      expect(await createMeeting({ ...base, meetingLink })).toEqual({ ok: false, error: refused });
      expect(tableCalls.filter((call) => call.action === "insert")).toEqual([]);
    },
  );

  it("accepts an https link, or none", async () => {
    for (const meetingLink of ["https://meet.google.com/abc-defg-hij", ""]) {
      const result = await createMeeting({ ...base, meetingLink });
      expect(result.error).not.toBe(refused);
    }
  });
});
