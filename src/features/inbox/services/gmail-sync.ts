import { mapGmailListToRows, type GmailListMessage, type GmailHubRow } from "@/features/inbox/services/gmail-ingest";

const GMAIL_LIST =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&labelIds=INBOX";

export async function fetchGmailMetadata(accessToken: string): Promise<GmailHubRow[]> {
  const listRes = await fetch(GMAIL_LIST, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list failed (${listRes.status}).`);
  }
  const list = (await listRes.json()) as { messages?: { id: string; threadId?: string }[] };
  const ids = (list.messages ?? []).slice(0, 30);
  const messages: GmailListMessage[] = [];
  for (const item of ids) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}`);
    url.searchParams.set("format", "metadata");
    url.searchParams.set("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "Subject");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) continue;
    messages.push((await res.json()) as GmailListMessage);
  }
  return mapGmailListToRows(messages);
}

export interface CalendarHubRow {
  external_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  html_link: string | null;
}

export async function fetchCalendarOverlay(accessToken: string): Promise<CalendarHubRow[]> {
  const timeMin = new Date().toISOString();
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("maxResults", "40");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Calendar list failed (${res.status}).`);
  const payload = (await res.json()) as {
    items?: {
      id?: string;
      summary?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (payload.items ?? [])
    .filter((event) => event.id)
    .map((event) => ({
      external_id: event.id!,
      title: event.summary || "(no title)",
      starts_at: event.start?.dateTime || event.start?.date || new Date().toISOString(),
      ends_at: event.end?.dateTime || event.end?.date || null,
      html_link: event.htmlLink ?? null,
    }));
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in?: number;
} | null> {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()) as { access_token: string; expires_in?: number };
}
