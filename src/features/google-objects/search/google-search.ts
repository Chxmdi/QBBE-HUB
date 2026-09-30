/**
 * Search across connected apps (V2-6): Google Drive and Gmail results for
 * Find, fetched with the searching person's own Google token, so each person
 * sees exactly what their own Google account can see. Never a shared or
 * service-account view: callers pass one person's tokens, and this module
 * has no way to reach anyone else's.
 */

export const MAX_TERM = 100;
export const RESULTS_PER_SOURCE = 10;

export type ConnectedSource = "drive" | "gmail";

export interface ConnectedResult {
  source: ConnectedSource;
  id: string;
  title: string;
  detail: string | null;
  href: string;
  /** ISO time: the file's last change or the message's date. */
  when: string | null;
}

export type SourceOutcome =
  | { source: ConnectedSource; status: "ok"; results: ConnectedResult[] }
  | { source: ConnectedSource; status: "not_connected" | "unavailable" };

/** The term as typed, trimmed and bounded; null when there is nothing to search. */
export function cleanTerm(raw: string | null | undefined): string | null {
  const term = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TERM);
  return term.length >= 2 ? term : null;
}

/**
 * The Drive `q` for a name search. Drive's grammar quotes values in single
 * quotes and escapes \ and '; the Hub's Drive scope is metadata-only, so the
 * search is on names, not contents.
 */
export function driveQuery(term: string): string {
  const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `name contains '${escaped}' and trashed = false`;
}

/**
 * The Gmail `q`. Quoted as one phrase so the term cannot add Gmail operators
 * (from:, has:, in:…) or reach outside what the person typed.
 */
export function gmailQuery(term: string): string {
  return `"${term.replace(/["\\]/g, " ").trim()}"`;
}

type Fetch = typeof fetch;

export async function searchDrive(accessToken: string, term: string, fetchImpl: Fetch = fetch): Promise<ConnectedResult[]> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", driveQuery(term));
  url.searchParams.set("pageSize", String(RESULTS_PER_SOURCE));
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,modifiedTime)");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive search failed (${res.status}).`);
  const body = (await res.json()) as {
    files?: { id?: unknown; name?: unknown; mimeType?: unknown; webViewLink?: unknown; modifiedTime?: unknown }[];
  };
  return (body.files ?? [])
    .filter((f) => typeof f.id === "string" && typeof f.webViewLink === "string")
    .map((f) => ({
      source: "drive" as const,
      id: f.id as string,
      title: typeof f.name === "string" && f.name ? f.name : (f.id as string),
      detail: typeof f.mimeType === "string" ? f.mimeType : null,
      href: safeGoogleHref(f.webViewLink as string, `https://drive.google.com/file/d/${f.id as string}/view`),
      when: typeof f.modifiedTime === "string" ? f.modifiedTime : null,
    }));
}

export async function searchGmail(accessToken: string, term: string, fetchImpl: Fetch = fetch): Promise<ConnectedResult[]> {
  const list = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  list.searchParams.set("q", gmailQuery(term));
  list.searchParams.set("maxResults", String(RESULTS_PER_SOURCE));
  const listRes = await fetchImpl(list, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) throw new Error(`Gmail search failed (${listRes.status}).`);
  const ids = (((await listRes.json()) as { messages?: { id?: unknown }[] }).messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9]+$/.test(id));

  const results: ConnectedResult[] = [];
  for (const id of ids) {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    url.searchParams.set("format", "metadata");
    url.searchParams.set("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "Subject");
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Gmail message failed (${res.status}).`);
    const message = (await res.json()) as {
      snippet?: unknown;
      internalDate?: unknown;
      payload?: { headers?: { name?: unknown; value?: unknown }[] };
    };
    const header = (name: string) =>
      message.payload?.headers?.find((h) => typeof h.name === "string" && h.name.toLowerCase() === name)?.value;
    const subject = header("subject");
    const from = header("from");
    const millis = typeof message.internalDate === "string" ? Number(message.internalDate) : NaN;
    results.push({
      source: "gmail",
      id,
      title: typeof subject === "string" && subject.trim() ? subject.trim() : "",
      detail: typeof from === "string" ? from : null,
      href: `https://mail.google.com/mail/u/0/#all/${id}`,
      when: Number.isFinite(millis) ? new Date(millis).toISOString() : null,
    });
  }
  return results;
}

/** Only Google's own https hosts are linked; anything else falls back to a built address. */
export function safeGoogleHref(raw: string, fallback: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol === "https:" && (host === "google.com" || host.endsWith(".google.com"))) return url.toString();
  } catch {
    // fall through
  }
  return fallback;
}
