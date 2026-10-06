import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb, type Answer, type TableCall } from "@/lib/objects/testing/fake-db";

const ORG = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const OWNER = "66666666-6666-4666-8666-666666666666";
const EVENT = "77777777-7777-4777-8777-777777777777";
const PROJECT = "88888888-8888-4888-8888-888888888888";

let tableCalls: TableCall[] = [];
let answer: (call: TableCall) => Answer;
let projectAllowed = true;
let isAdmin = false;
const deleteGoogleEventRecord = vi.fn();
const updateGoogleEventRecord = vi.fn();
const createGoogleEventRecord = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", () => ({
  requireSession: async () => ({ userId: ME, organizationId: ORG, timeZone: "America/Toronto", isAdmin }),
}));
vi.mock("@/lib/i18n/server", async () => {
  const { createTranslator } = await import("@/lib/i18n/translate");
  return { getLocale: async () => "en", getT: async () => createTranslator("en") };
});
vi.mock("@/lib/access-capabilities", () => ({
  hasProjectCapability: async () => projectAllowed,
  hasProgramCapability: async () => projectAllowed,
}));
vi.mock("@/features/calendar/services/google-calendar-write", () => ({
  createGoogleEventRecord: (...a: unknown[]) => createGoogleEventRecord(...a),
  updateGoogleEventRecord: (...a: unknown[]) => updateGoogleEventRecord(...a),
  deleteGoogleEventRecord: (...a: unknown[]) => deleteGoogleEventRecord(...a),
  calendarFailureStatus: () => "degraded",
}));
vi.mock("@/features/jobs/services/notify", () => ({
  createNotifications: async () => undefined,
  notificationDedupeKey: () => "k",
}));
vi.mock("@/features/admin/services/workflow.runtime", () => ({ fireWorkflows: async () => undefined }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = fakeDb({ table: (call) => answer(call) });
    tableCalls = fake.tableCalls;
    return fake.db;
  },
}));

const { createEvent, updateEvent, updateEventStatus } = await import("../services/event.commands");

const existing = { id: EVENT, owner_id: OWNER, status: "planning" };
/** A manager's update returns the row; a reader's matches nothing. */
function db({ canManage }: { canManage: boolean }) {
  return (call: TableCall): Answer => {
    if (call.table === "event" && call.action === "select") return { data: existing, error: null };
    if (call.table === "event" && call.action === "update") return { data: canManage ? [{ id: EVENT }] : [], error: null };
    return { data: null, error: null };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tableCalls = [];
  projectAllowed = true;
  isAdmin = false;
  answer = db({ canManage: true });
});

describe("createEvent", () => {
  const base = { name: "Fall fair", projectId: PROJECT, startsAt: "2026-11-07T10:00", endsAt: "2026-11-07T14:00" };

  it("creates the event in the organization's time zone and links it to the calendar", async () => {
    const result = await createEvent(base);
    expect(result.ok).toBe(true);
    const insert = tableCalls.find((c) => c.table === "event" && c.action === "insert");
    // 10:00 in Toronto in November (EST) is 15:00 UTC.
    expect(insert?.payload).toMatchObject({ name: "Fall fair", project_id: PROJECT, starts_at: "2026-11-07T15:00:00.000Z", ends_at: "2026-11-07T19:00:00.000Z" });
    expect(createGoogleEventRecord).toHaveBeenCalledOnce();
  });

  it("gives an event without an end one hour", async () => {
    await createEvent({ ...base, endsAt: undefined });
    const insert = tableCalls.find((c) => c.table === "event" && c.action === "insert");
    expect(insert?.payload).toMatchObject({ ends_at: "2026-11-07T16:00:00.000Z" });
  });

  it("refuses an end before the start, a missing name and an impossible day", async () => {
    expect(await createEvent({ ...base, endsAt: "2026-11-07T09:00" })).toEqual({ ok: false, error: "End time must be after the event starts." });
    expect((await createEvent({ ...base, name: " " })).ok).toBe(false);
    expect((await createEvent({ ...base, startsAt: "2026-02-31T10:00", endsAt: undefined })).ok).toBe(false);
    expect(tableCalls.some((c) => c.action === "insert")).toBe(false);
  });

  it("refuses a project the person cannot work in, and no project unless an admin", async () => {
    projectAllowed = false;
    expect((await createEvent(base)).ok).toBe(false);
    expect((await createEvent({ ...base, projectId: undefined })).ok).toBe(false);
    expect(tableCalls.some((c) => c.action === "insert")).toBe(false);
  });

  it("keeps the event when the calendar write fails and marks the connection", async () => {
    createGoogleEventRecord.mockRejectedValueOnce(new Error("Google down"));
    expect((await createEvent(base)).ok).toBe(true);
    const marked = tableCalls.find((c) => c.table === "integration_connection" && c.action === "update");
    expect(marked?.payload).toMatchObject({ status: "degraded", last_error: "Google down" });
  });
});

describe("updateEvent", () => {
  const edit = { eventId: EVENT, name: "Fall fair", startsAt: "2026-11-07T10:00", endsAt: "2026-11-07T14:00" };

  it("saves and updates the owner's calendar record", async () => {
    expect(await updateEvent(edit)).toEqual({ ok: true, id: EVENT });
    expect(updateGoogleEventRecord).toHaveBeenCalledWith(expect.objectContaining({ userId: OWNER, eventId: EVENT }));
  });

  it("tells someone who can read but not manage the event, and leaves the calendar alone", async () => {
    answer = db({ canManage: false });
    expect(await updateEvent(edit)).toEqual({ ok: false, error: "Only someone who manages this event can change it." });
    expect(updateGoogleEventRecord).not.toHaveBeenCalled();
  });

  it("refuses a cancelled event and one that cannot be found", async () => {
    answer = (call) => (call.action === "select" ? { data: { ...existing, status: "cancelled" }, error: null } : { data: [], error: null });
    expect(await updateEvent(edit)).toEqual({ ok: false, error: "Cancelled events cannot be changed." });
    answer = () => ({ data: null, error: null });
    expect(await updateEvent(edit)).toEqual({ ok: false, error: "Event not found." });
  });
});

describe("updateEventStatus", () => {
  it("cancelling removes the calendar record once", async () => {
    expect((await updateEventStatus({ eventId: EVENT, status: "cancelled" })).ok).toBe(true);
    expect(deleteGoogleEventRecord).toHaveBeenCalledWith({ organizationId: ORG, userId: OWNER, eventId: EVENT });
  });

  it("a reader's cancel changes nothing and does not delete the owner's calendar event", async () => {
    answer = db({ canManage: false });
    expect(await updateEventStatus({ eventId: EVENT, status: "cancelled" })).toEqual({
      ok: false,
      error: "Only someone who manages this event can change it.",
    });
    expect(deleteGoogleEventRecord).not.toHaveBeenCalled();
  });

  it("refuses a status that does not exist", async () => {
    expect((await updateEventStatus({ eventId: EVENT, status: "postponed" })).ok).toBe(false);
    expect(tableCalls).toHaveLength(0);
  });
});
