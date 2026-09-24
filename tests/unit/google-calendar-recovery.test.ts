import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../support/fake-supabase";

// The Calendar write service builds its own privileged client; hand it the
// in-memory double instead, so every read and write below is observable.
let db: FakeSupabase;
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => db,
}));

const {
  calendarExternalId,
  calendarFailureStatus,
  createGoogleMeetingEvent,
  deleteGoogleMeetingEvent,
  updateGoogleMeetingEvent,
} = await import("@/features/calendar/services/google-calendar-write");

const ORG = "org-1";
const USER = "user-1";
const CONNECTION = "calendar-connection-1";
const MEETING = "11111111-1111-1111-1111-111111111111";
const EXTERNAL_ID = calendarExternalId({ kind: "meeting", id: MEETING });

// 2026-11-01 is when Montréal leaves daylight saving time. 09:00 local is
// 13:00Z the day before and 14:00Z on the day; the service must send the
// instants it is given, not re-derive them from a fixed offset.
const MEETING_INPUT = {
  organizationId: ORG,
  userId: USER,
  meetingId: MEETING,
  title: "Board meeting",
  purpose: "Quarterly review",
  startsAt: "2026-11-01T14:00:00.000Z",
  endsAt: "2026-11-01T15:00:00.000Z",
  location: null,
};

function seed({
  status = "connected",
  tokenExpiresAt = new Date(Date.now() + 60 * 60_000).toISOString(),
  refreshToken = "refresh-token" as string | null,
  linked = false,
} = {}) {
  db.seed("integration_connection", [{
    id: CONNECTION,
    organization_id: ORG,
    user_id: USER,
    provider: "google_calendar",
    status,
  }]);
  db.seed("integration_secret", [{
    connection_id: CONNECTION,
    access_token: "access-token",
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
  }]);
  db.seed("calendar_event_link", linked
    ? [{
      id: "link-1",
      organization_id: ORG,
      user_id: USER,
      connection_id: CONNECTION,
      external_id: EXTERNAL_ID,
      meeting_id: MEETING,
      title: "Board meeting",
    }]
    : []);
}

function googleEvent(status = 200) {
  return new Response(JSON.stringify({
    id: EXTERNAL_ID,
    htmlLink: "https://calendar.google.com/event?eid=1",
    updated: "2026-09-24T12:00:00Z",
  }), { status });
}

function calls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: (init as RequestInit | undefined)?.method ?? "GET",
    auth: ((init as RequestInit | undefined)?.headers as Record<string, string> | undefined)?.Authorization,
  }));
}

beforeEach(() => {
  db = new FakeSupabase();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Calendar token expiry", () => {
  it("refreshes an expired token, saves it, and writes the event with the new one", async () => {
    seed({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "fresh-token",
        expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(googleEvent());
    vi.stubGlobal("fetch", fetchMock);

    await createGoogleMeetingEvent(MEETING_INPUT);

    const [refresh, create] = calls(fetchMock);
    expect(refresh.url).toBe("https://oauth2.googleapis.com/token");
    expect(create).toMatchObject({ method: "POST", auth: "Bearer fresh-token" });
    expect(db.rows("integration_secret")[0]).toMatchObject({ access_token: "fresh-token" });
    expect(db.rows("calendar_event_link")).toEqual([
      expect.objectContaining({ meeting_id: MEETING, external_id: EXTERNAL_ID }),
    ]);
  });

  it("stops before touching Google when consent was revoked, and says to reconnect", async () => {
    seed({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    // Google answers a refresh with a revoked grant as 400 invalid_grant.
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const failure = await createGoogleMeetingEvent(MEETING_INPUT).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/Reconnect Calendar/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("calendar_event_link")).toHaveLength(0);
    // What the meeting and event commands then record on the connection.
    expect(calendarFailureStatus(failure, "Calendar sync failed.")).toBe("authentication_expired");
  });

  it("says to reconnect when there is no refresh token to use", async () => {
    seed({ tokenExpiresAt: new Date(Date.now() - 60_000).toISOString(), refreshToken: null });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const failure = await createGoogleMeetingEvent(MEETING_INPUT).catch((error: unknown) => error);

    expect(calendarFailureStatus(failure, "Calendar sync failed.")).toBe("authentication_expired");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Calendar provider failures", () => {
  it("reports an outage as delayed, not as an authorization problem, and keeps the link", async () => {
    seed({ linked: true });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const failure = await updateGoogleMeetingEvent(MEETING_INPUT).catch((error: unknown) => error);

    expect(calendarFailureStatus(failure, "Calendar update failed.")).toBe("synchronization_delayed");
    expect(db.rows("calendar_event_link")).toEqual([
      expect.objectContaining({ id: "link-1", external_id: EXTERNAL_ID }),
    ]);
  });

  it("recreates an event somebody deleted in Google, under the same deterministic id", async () => {
    seed({ linked: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(googleEvent());
    vi.stubGlobal("fetch", fetchMock);

    await updateGoogleMeetingEvent(MEETING_INPUT);

    const [patch, create] = calls(fetchMock);
    expect(patch).toMatchObject({ method: "PATCH" });
    expect(create).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      id: EXTERNAL_ID,
      start: { dateTime: "2026-11-01T14:00:00.000Z" },
      end: { dateTime: "2026-11-01T15:00:00.000Z" },
    });
    expect(db.rows("calendar_event_link")).toEqual([
      expect.objectContaining({ meeting_id: MEETING, external_id: EXTERNAL_ID }),
    ]);
  });
});

describe("Calendar reconnect", () => {
  it("does not call Google or fail the Hub write while Calendar is disconnected", async () => {
    seed({ status: "authentication_expired" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGoogleMeetingEvent(MEETING_INPUT)).resolves.toBeNull();
    await expect(updateGoogleMeetingEvent(MEETING_INPUT)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("catches up a meeting saved while disconnected on its next edit after reconnecting", async () => {
    seed({ status: "connected" });
    const fetchMock = vi.fn().mockResolvedValueOnce(googleEvent());
    vi.stubGlobal("fetch", fetchMock);

    await updateGoogleMeetingEvent({ ...MEETING_INPUT, title: "Board meeting (moved)" });

    expect(calls(fetchMock)).toEqual([expect.objectContaining({ method: "POST" })]);
    expect(db.rows("calendar_event_link")).toEqual([
      expect.objectContaining({
        meeting_id: MEETING,
        external_id: EXTERNAL_ID,
        title: "Board meeting (moved)",
      }),
    ]);
  });
});

describe("Calendar cancellation", () => {
  it("is safe to repeat: a second cancel neither calls Google nor fails", async () => {
    seed({ linked: true });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteGoogleMeetingEvent(MEETING_INPUT)).resolves.toBe(true);
    await expect(deleteGoogleMeetingEvent(MEETING_INPUT)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows("calendar_event_link")).toHaveLength(0);
  });

  it("treats an event already gone from Google as cancelled", async () => {
    seed({ linked: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));

    await expect(deleteGoogleMeetingEvent(MEETING_INPUT)).resolves.toBe(true);
    expect(db.rows("calendar_event_link")).toHaveLength(0);
  });

  it("keeps the link for a retry when Google refuses the cancellation", async () => {
    seed({ linked: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 })));

    const failure = await deleteGoogleMeetingEvent(MEETING_INPUT).catch((error: unknown) => error);

    expect(calendarFailureStatus(failure, "Calendar cancellation failed.")).toBe("synchronization_delayed");
    expect(db.rows("calendar_event_link")).toHaveLength(1);
  });
});

describe("Google sync recovers a connection after an outage", () => {
  it("retries a delayed connection and marks it connected again, but leaves an expired one for the user", async () => {
    const { googleSync } = await import("@/features/jobs/services/handlers/google-sync");
    const now = new Date("2026-09-24T12:00:00Z");
    db.seed("integration_connection", [
      { id: "delayed", organization_id: ORG, user_id: USER, provider: "google_calendar", status: "synchronization_delayed", last_error: "Calendar list failed (503)." },
      { id: "expired", organization_id: ORG, user_id: "user-2", provider: "google_calendar", status: "authentication_expired", last_error: "invalid_grant" },
    ]);
    db.seed("integration_secret", [
      { connection_id: "delayed", access_token: "access-token", refresh_token: "r", token_expires_at: new Date(Date.now() + 3_600_000).toISOString() },
      { connection_id: "expired", access_token: "stale", refresh_token: "r", token_expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    ]);
    db.seed("calendar_event_link", []);
    db.seed("background_job_run", []);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [], nextSyncToken: "sync-1" }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await googleSync({
      db: db as never,
      definition: { name: "google-sync", description: "", schedule: "", queue: "", enabled: true, batch_size: 25, max_attempts: 5 },
      now,
    });

    expect(result).toMatchObject({ processed: 1, failed: 0 });
    expect(calls(fetchMock).every((call) => call.auth === "Bearer access-token")).toBe(true);
    const connections = Object.fromEntries(
      db.rows("integration_connection").map((row) => [row.id, row]),
    );
    expect(connections.delayed).toMatchObject({ status: "connected", last_error: null });
    expect(connections.expired).toMatchObject({ status: "authentication_expired" });
  });
});
