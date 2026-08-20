import { mapGmailListToRows, type GmailListMessage, type GmailHubRow } from "@/features/inbox/services/gmail-ingest";

const GMAIL_LIST = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_PAGE_SIZE = "500";
const GMAIL_METADATA_CONCURRENCY = 10;

export const GMAIL_WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60_000;

export interface GmailWatch {
  historyId: string;
  expirationAt: string;
}

export interface GmailPushNotification {
  emailAddress: string;
  historyId: string;
}

export function gmailPushClaimsAreValid(
  claims: { aud?: unknown; email?: unknown; email_verified?: unknown; exp?: unknown },
  audience: string | undefined,
  serviceAccount: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  return Boolean(
    audience && serviceAccount &&
    claims.aud === audience &&
    typeof claims.email === "string" && claims.email.toLowerCase() === serviceAccount.toLowerCase() &&
    (claims.email_verified === true || claims.email_verified === "true") &&
    Number(claims.exp) > nowSeconds,
  );
}

export function gmailWatchNeedsRenewal(expirationAt: string | null | undefined, now = Date.now()): boolean {
  if (!expirationAt) return true;
  const expiry = new Date(expirationAt).getTime();
  return !Number.isFinite(expiry) || expiry <= now + GMAIL_WATCH_RENEWAL_LEAD_MS;
}

/** Parses the data envelope sent by a Google Cloud Pub/Sub push subscription. */
export function parseGmailPushNotification(data: string): GmailPushNotification | null {
  try {
    const payload = JSON.parse(Buffer.from(data, "base64").toString("utf8")) as {
      emailAddress?: unknown; historyId?: unknown;
    };
    if (
      typeof payload.emailAddress !== "string" ||
      payload.emailAddress.length > 320 ||
      typeof payload.historyId !== "string" ||
      !/^\d+$/.test(payload.historyId)
    ) return null;
    return { emailAddress: payload.emailAddress.toLowerCase(), historyId: payload.historyId };
  } catch {
    return null;
  }
}

export async function fetchGmailProfile(accessToken: string): Promise<{ emailAddress: string; historyId: string | null }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail profile failed (${res.status}).`);
  const payload = (await res.json()) as { emailAddress?: unknown; historyId?: unknown };
  if (typeof payload.emailAddress !== "string") throw new Error("Gmail profile did not include an email address.");
  return {
    emailAddress: payload.emailAddress.toLowerCase(),
    historyId: typeof payload.historyId === "string" ? payload.historyId : null,
  };
}

export async function createGmailInboxWatch(accessToken: string, topicName: string): Promise<GmailWatch> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }),
  });
  const payload = (await res.json().catch(() => null)) as { historyId?: unknown; expiration?: unknown } | null;
  if (!res.ok) throw new Error(`Gmail watch failed (${res.status}).`);
  if (typeof payload?.historyId !== "string" || typeof payload.expiration !== "string") {
    throw new Error("Gmail watch response was incomplete.");
  }
  const expiry = Number(payload.expiration);
  if (!Number.isFinite(expiry)) throw new Error("Gmail watch expiration was invalid.");
  return { historyId: payload.historyId, expirationAt: new Date(expiry).toISOString() };
}

export async function fetchGmailHistory(accessToken: string, startHistoryId: string): Promise<{
  messageIds: string[];
  historyId: string | null;
}> {
  let pageToken: string | undefined;
  let historyId: string | null = null;
  const messageIds = new Set<string>();

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", startHistoryId);
    url.searchParams.set("labelId", "INBOX");
    url.searchParams.set("maxResults", GMAIL_PAGE_SIZE);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) throw new Error("Gmail history cursor expired; a full synchronization is required.");
    if (!res.ok) throw new Error(`Gmail history failed (${res.status}).`);
    const payload = (await res.json()) as GmailHistoryPage;
    for (const id of gmailHistoryMessageIds(payload.history ?? [])) messageIds.add(id);
    if (typeof payload.historyId === "string") historyId = payload.historyId;
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
  } while (pageToken);

  return { messageIds: [...messageIds], historyId };
}

type GmailHistoryMessage = { id?: unknown };
type GmailHistoryEntry = {
  messages?: GmailHistoryMessage[];
  messagesAdded?: { message?: GmailHistoryMessage }[];
  messagesDeleted?: { message?: GmailHistoryMessage }[];
  labelsAdded?: { message?: GmailHistoryMessage }[];
  labelsRemoved?: { message?: GmailHistoryMessage }[];
};
type GmailHistoryPage = {
  history?: GmailHistoryEntry[];
  historyId?: unknown;
  nextPageToken?: unknown;
};

/** Gmail repeats messages across history event variants. Collect every changed
 * message once so metadata refreshes and removals are reconciled reliably. */
export function gmailHistoryMessageIds(entries: GmailHistoryEntry[]): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const messages = [
      ...(entry.messages ?? []),
      ...(entry.messagesAdded ?? []).map((change) => change.message),
      ...(entry.messagesDeleted ?? []).map((change) => change.message),
      ...(entry.labelsAdded ?? []).map((change) => change.message),
      ...(entry.labelsRemoved ?? []).map((change) => change.message),
    ];
    for (const message of messages) {
      if (typeof message?.id === "string") ids.add(message.id);
    }
  }
  return [...ids];
}

async function fetchGmailMessageMetadata(accessToken: string, id: string): Promise<GmailHubRow | null> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.set("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Gmail message metadata failed (${res.status}).`);
  const message = (await res.json()) as GmailListMessage & { labelIds?: string[] };
  if (!message.labelIds?.includes("INBOX")) return null;
  return mapGmailListToRows([message])[0] ?? null;
}

/** Current metadata for changed Inbox IDs. Missing/removed items are returned
 * separately so the Hub can reconcile its durable metadata mirror. */
export async function fetchGmailChangedMetadata(accessToken: string, messageIds: string[]): Promise<{
  rows: GmailHubRow[];
  removedIds: string[];
}> {
  const rows: GmailHubRow[] = [];
  const removedIds: string[] = [];
  for (const id of messageIds) {
    const row = await fetchGmailMessageMetadata(accessToken, id);
    if (row) rows.push(row); else removedIds.push(id);
  }
  return { rows, removedIds };
}

export async function fetchGmailMetadata(accessToken: string): Promise<GmailHubRow[]> {
  let pageToken: string | undefined;
  const ids = new Set<string>();
  do {
    const url = new URL(GMAIL_LIST);
    url.searchParams.set("maxResults", GMAIL_PAGE_SIZE);
    url.searchParams.set("labelIds", "INBOX");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status}).`);
    const list = (await listRes.json()) as {
      messages?: { id?: unknown }[];
      nextPageToken?: unknown;
    };
    for (const message of list.messages ?? []) {
      if (typeof message.id === "string") ids.add(message.id);
    }
    pageToken = typeof list.nextPageToken === "string" ? list.nextPageToken : undefined;
  } while (pageToken);

  const rows: GmailHubRow[] = [];
  const pendingIds = [...ids];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(GMAIL_METADATA_CONCURRENCY, pendingIds.length) },
    async () => {
      while (nextIndex < pendingIds.length) {
        const id = pendingIds[nextIndex++];
        const row = await fetchGmailMessageMetadata(accessToken, id);
        if (row) rows.push(row);
      }
    },
  );
  await Promise.all(workers);
  return rows;
}

export interface CalendarHubRow {
  external_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  html_link: string | null;
  external_updated_at: string | null;
}

export interface CalendarOverlaySync {
  rows: CalendarHubRow[];
  removedIds: string[];
  syncToken: string;
}

type GoogleCalendarEvent = {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  htmlLink?: unknown;
  updated?: unknown;
  start?: { dateTime?: unknown; date?: unknown };
  end?: { dateTime?: unknown; date?: unknown };
};

type GoogleCalendarPage = {
  items?: GoogleCalendarEvent[];
  nextPageToken?: unknown;
  nextSyncToken?: unknown;
};

function calendarEventTime(value: GoogleCalendarEvent["start"]): string | null {
  if (typeof value?.dateTime === "string") return value.dateTime;
  if (typeof value?.date === "string") return value.date;
  return null;
}

/**
 * Mirrors Calendar changes page-by-page. Google requires an initial full sync
 * to obtain a token, then requests with that same token until the final page.
 * A 410 response means Google invalidated the token and the caller must start
 * again with a fresh full synchronization.
 */
export async function fetchCalendarOverlay(accessToken: string, syncToken?: string): Promise<CalendarOverlaySync> {
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const rowsById = new Map<string, CalendarHubRow>();
  const removedIds = new Set<string>();

  do {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    if (syncToken) url.searchParams.set("syncToken", syncToken);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw new Error("Google Calendar sync token expired; a full synchronization is required.");
    if (!res.ok) throw new Error(`Calendar list failed (${res.status}).`);
    const payload = (await res.json()) as GoogleCalendarPage;

    for (const event of payload.items ?? []) {
      if (typeof event.id !== "string") continue;
      if (event.status === "cancelled") {
        rowsById.delete(event.id);
        removedIds.add(event.id);
        continue;
      }
      const startsAt = calendarEventTime(event.start);
      if (!startsAt) continue;
      removedIds.delete(event.id);
      rowsById.set(event.id, {
        external_id: event.id,
        title: typeof event.summary === "string" && event.summary ? event.summary : "(no title)",
        starts_at: startsAt,
        ends_at: calendarEventTime(event.end),
        html_link: typeof event.htmlLink === "string" ? event.htmlLink : null,
        external_updated_at: typeof event.updated === "string" ? event.updated : null,
      });
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
    if (typeof payload.nextSyncToken === "string") nextSyncToken = payload.nextSyncToken;
  } while (pageToken);

  if (!nextSyncToken) throw new Error("Calendar synchronization response did not include a next sync token.");
  return { rows: [...rowsById.values()], removedIds: [...removedIds], syncToken: nextSyncToken };
}

export interface GoogleDriveHubRow {
  external_id: string;
  title: string;
  description: string | null;
  url: string;
  mime_type: string | null;
  updated_at: string | null;
}

export interface GoogleDriveSync {
  rows: GoogleDriveHubRow[];
  removedIds: string[];
  pageToken: string;
}

type GoogleDriveFile = {
  id?: unknown; name?: unknown; description?: unknown; mimeType?: unknown;
  modifiedTime?: unknown; webViewLink?: unknown; trashed?: unknown;
};

const DRIVE_FILE_FIELDS = "id,name,description,mimeType,modifiedTime,webViewLink,trashed";

function mapGoogleDriveFile(file: GoogleDriveFile): GoogleDriveHubRow | null {
  if (typeof file.id !== "string" || typeof file.webViewLink !== "string" || file.trashed === true) return null;
  return {
    external_id: file.id,
    title: typeof file.name === "string" && file.name ? file.name : "Untitled Drive file",
    description: typeof file.description === "string" && file.description ? file.description : null,
    url: file.webViewLink,
    mime_type: typeof file.mimeType === "string" ? file.mimeType : null,
    updated_at: typeof file.modifiedTime === "string" ? file.modifiedTime : null,
  };
}

async function fetchGoogleDriveStartPageToken(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/drive/v3/changes/startPageToken", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Drive start-page-token request failed (${res.status}).`);
  const payload = (await res.json()) as { startPageToken?: unknown };
  if (typeof payload.startPageToken !== "string") throw new Error("Google Drive did not return a start page token.");
  return payload.startPageToken;
}

async function fetchGoogleDriveFullMetadata(accessToken: string): Promise<GoogleDriveHubRow[]> {
  let pageToken: string | undefined;
  const rows = new Map<string, GoogleDriveHubRow>();
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("q", "trashed = false");
    url.searchParams.set("fields", `nextPageToken,files(${DRIVE_FILE_FIELDS})`);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Google Drive list failed (${res.status}).`);
    const payload = (await res.json()) as { files?: GoogleDriveFile[]; nextPageToken?: unknown };
    for (const file of payload.files ?? []) {
      const row = mapGoogleDriveFile(file);
      if (row) rows.set(row.external_id, row);
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
  } while (pageToken);
  return [...rows.values()];
}

/** Reads Drive metadata only. File bytes and OAuth credentials stay with Google.
 * A full mirror obtains a token first; later calls consume the changes feed. */
export async function fetchGoogleDriveSync(accessToken: string, savedPageToken?: string): Promise<GoogleDriveSync> {
  if (!savedPageToken) {
    const pageToken = await fetchGoogleDriveStartPageToken(accessToken);
    return { rows: await fetchGoogleDriveFullMetadata(accessToken), removedIds: [], pageToken };
  }

  let pageToken: string | undefined = savedPageToken;
  let nextStartPageToken: string | undefined;
  const rows = new Map<string, GoogleDriveHubRow>();
  const removedIds = new Set<string>();
  do {
    const url = new URL("https://www.googleapis.com/drive/v3/changes");
    url.searchParams.set("pageToken", pageToken);
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("includeRemoved", "true");
    url.searchParams.set("fields", `nextPageToken,newStartPageToken,changes(fileId,removed,file(${DRIVE_FILE_FIELDS}))`);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw new Error("Google Drive page token expired; a full synchronization is required.");
    if (!res.ok) throw new Error(`Google Drive changes failed (${res.status}).`);
    const payload = (await res.json()) as {
      changes?: { fileId?: unknown; removed?: unknown; file?: GoogleDriveFile }[];
      nextPageToken?: unknown; newStartPageToken?: unknown;
    };
    for (const change of payload.changes ?? []) {
      if (typeof change.fileId !== "string") continue;
      const row = change.removed === true ? null : mapGoogleDriveFile(change.file ?? {});
      if (row) {
        removedIds.delete(change.fileId);
        rows.set(change.fileId, row);
      } else {
        rows.delete(change.fileId);
        removedIds.add(change.fileId);
      }
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : undefined;
    if (typeof payload.newStartPageToken === "string") nextStartPageToken = payload.newStartPageToken;
  } while (pageToken);
  if (!nextStartPageToken) throw new Error("Google Drive changes response did not include a new start page token.");
  return { rows: [...rows.values()], removedIds: [...removedIds], pageToken: nextStartPageToken };
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
