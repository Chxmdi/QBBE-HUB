import { refreshGoogleAccessToken } from "@/features/inbox/services/gmail-sync";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

type LinkedHubRecord =
  | { kind: "meeting"; id: string }
  | { kind: "event"; id: string };

type CalendarRecordInput = {
  organizationId: string;
  userId: string;
  record: LinkedHubRecord;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
};

type CalendarLink = {
  id: string;
  connection_id: string;
  external_id: string;
};

export function calendarLinkRecordFields(record: LinkedHubRecord) {
  return record.kind === "meeting" ? { meeting_id: record.id } : { event_id: record.id };
}

async function findCalendarLink(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  organizationId: string,
  userId: string,
  record: LinkedHubRecord,
) {
  let query = supabase
    .from("calendar_event_link")
    .select("id, connection_id, external_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  query = record.kind === "meeting"
    ? query.eq("meeting_id", record.id)
    : query.eq("event_id", record.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not load the Google Calendar link: ${error.message}`);
  return data as CalendarLink | null;
}

async function calendarAccessToken(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  connectionId: string,
) {
  const { data: secret, error: secretError } = await supabase
    .from("integration_secret")
    .select("access_token, refresh_token, token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (secretError || !secret?.access_token) {
    throw new Error("Google Calendar authorization is unavailable. Reconnect Calendar.");
  }

  let token = secret.access_token as string;
  const expiry = secret.token_expires_at ? new Date(secret.token_expires_at as string).getTime() : 0;
  if (expiry && expiry < Date.now() + 60_000) {
    if (!secret.refresh_token) throw new Error("Google Calendar authorization expired. Reconnect Calendar.");
    const refreshed = await refreshGoogleAccessToken(secret.refresh_token as string);
    if (!refreshed?.access_token) throw new Error("Google Calendar authorization expired. Reconnect Calendar.");
    token = refreshed.access_token;
    const { error } = await supabase
      .from("integration_secret")
      .update({
        access_token: token,
        token_expires_at: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          : null,
      })
      .eq("connection_id", connectionId);
    if (error) throw new Error(`Could not save refreshed Calendar authorization: ${error.message}`);
  }
  return token;
}

/** Creates an event that Hub owns and can safely reconcile later. It never
 * updates arbitrary Calendar items imported into the overlay. */
async function createGoogleCalendarRecord(input: CalendarRecordInput) {
  const supabase = createSupabaseServiceClient();
  const { data: connection, error: connectionError } = await supabase
    .from("integration_connection")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("user_id", input.userId)
    .eq("provider", "google_calendar")
    .eq("status", "connected")
    .maybeSingle();
  if (connectionError) throw new Error(`Could not load Calendar connection: ${connectionError.message}`);
  if (!connection) return null;

  const token = await calendarAccessToken(supabase, connection.id);
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.title,
      description: input.description ?? undefined,
      location: input.location ?? undefined,
      start: { dateTime: input.startsAt },
      end: { dateTime: input.endsAt },
    }),
  });
  if (!response.ok) throw new Error(`Google Calendar rejected the event (${response.status}).`);
  const event = await response.json() as { id?: string; htmlLink?: string; updated?: string };
  if (!event.id) throw new Error("Google Calendar returned no event id.");

  const { error: linkError } = await supabase.from("calendar_event_link").upsert({
    organization_id: input.organizationId,
    user_id: input.userId,
    connection_id: connection.id,
    external_id: event.id,
    title: input.title,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    html_link: event.htmlLink ?? null,
    external_updated_at: event.updated ?? null,
    ...calendarLinkRecordFields(input.record),
  }, { onConflict: "user_id,external_id" });
  if (linkError) throw new Error(`Could not save the Google Calendar link: ${linkError.message}`);
  return event.htmlLink ?? null;
}

/** Updates only a Hub-owned Calendar link. Attendee-managed fields remain in
 * Google Calendar and are never sent by QBBE Hub. */
async function updateGoogleCalendarRecord(input: CalendarRecordInput) {
  const supabase = createSupabaseServiceClient();
  const link = await findCalendarLink(supabase, input.organizationId, input.userId, input.record);
  if (!link) return null;
  const token = await calendarAccessToken(supabase, link.connection_id);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(link.external_id)}?sendUpdates=none`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? "",
        location: input.location ?? "",
        start: { dateTime: input.startsAt },
        end: { dateTime: input.endsAt },
      }),
    },
  );
  if (!response.ok) throw new Error(`Google Calendar rejected the update (${response.status}).`);
  const event = await response.json() as { htmlLink?: string; updated?: string };
  const { error } = await supabase.from("calendar_event_link").update({
    title: input.title,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    html_link: event.htmlLink ?? null,
    external_updated_at: event.updated ?? null,
  }).eq("id", link.id);
  if (error) throw new Error(`Could not save the updated Calendar link: ${error.message}`);
  return event.htmlLink ?? null;
}

/** A missing Google event is a successful terminal state for a cancellation. */
export function calendarEventDeleteSucceeded(status: number) {
  return status === 404 || (status >= 200 && status < 300);
}

async function deleteGoogleCalendarRecord(input: {
  organizationId: string;
  userId: string;
  record: LinkedHubRecord;
}) {
  const supabase = createSupabaseServiceClient();
  const link = await findCalendarLink(supabase, input.organizationId, input.userId, input.record);
  if (!link) return false;
  const token = await calendarAccessToken(supabase, link.connection_id);
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(link.external_id)}?sendUpdates=none`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!calendarEventDeleteSucceeded(response.status)) {
    throw new Error(`Google Calendar rejected the cancellation (${response.status}).`);
  }
  const { error } = await supabase.from("calendar_event_link").delete().eq("id", link.id);
  if (error) throw new Error(`Could not remove the Calendar link: ${error.message}`);
  return true;
}

export function createGoogleMeetingEvent(input: {
  organizationId: string; userId: string; meetingId: string; title: string;
  purpose: string | null; startsAt: string; endsAt: string; location: string | null;
}) {
  return createGoogleCalendarRecord({ ...input, description: input.purpose, record: { kind: "meeting", id: input.meetingId } });
}

export function updateGoogleMeetingEvent(input: {
  organizationId: string; userId: string; meetingId: string; title: string;
  purpose: string | null; startsAt: string; endsAt: string; location: string | null;
}) {
  return updateGoogleCalendarRecord({ ...input, description: input.purpose, record: { kind: "meeting", id: input.meetingId } });
}

export function deleteGoogleMeetingEvent(input: { organizationId: string; userId: string; meetingId: string }) {
  return deleteGoogleCalendarRecord({ ...input, record: { kind: "meeting", id: input.meetingId } });
}

export function createGoogleEventRecord(input: {
  organizationId: string; userId: string; eventId: string; title: string;
  description: string | null; startsAt: string; endsAt: string; location: string | null;
}) {
  return createGoogleCalendarRecord({ ...input, record: { kind: "event", id: input.eventId } });
}

export function updateGoogleEventRecord(input: {
  organizationId: string; userId: string; eventId: string; title: string;
  description: string | null; startsAt: string; endsAt: string; location: string | null;
}) {
  return updateGoogleCalendarRecord({ ...input, record: { kind: "event", id: input.eventId } });
}

export function deleteGoogleEventRecord(input: { organizationId: string; userId: string; eventId: string }) {
  return deleteGoogleCalendarRecord({ ...input, record: { kind: "event", id: input.eventId } });
}
