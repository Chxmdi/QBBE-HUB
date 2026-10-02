/**
 * Page presence rules shared by the server and the browser (wave 2, C1).
 */

/**
 * How often an open page says "still here"; each beat also reads the list
 * back, so arrivals and goodbyes show within this time. (The table is not
 * published to Realtime: see the migration.)
 */
export const PRESENCE_HEARTBEAT_MS = 5_000;
/**
 * Matches the read policy on page_presence: an older row counts as gone.
 * Several heartbeats fit in it, so a lost beat does not make someone
 * flicker, and a tab that vanished without a goodbye leaves the header
 * within PRESENCE_TTL_MS + PRESENCE_HEARTBEAT_MS (25 s, under the 30 s promise).
 */
export const PRESENCE_TTL_MS = 20_000;

export interface PagePresencePerson {
  userId: string;
  name: string;
  editing: boolean;
}

/**
 * Colours for people on a page. Each carries white text at 4.5:1 or more,
 * in both themes (the chip has its own background).
 */
export const PRESENCE_COLOURS = [
  "#1d4ed8",
  "#b91c1c",
  "#047857",
  "#7e22ce",
  "#c2410c",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
] as const;

/** The same person always gets the same colour, on every screen. */
export function presenceColour(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return PRESENCE_COLOURS[hash % PRESENCE_COLOURS.length];
}

/** Initials for a chip: first letters of the first and last words. */
export function presenceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rows from page_presence_list, checked; one entry per person. */
export function parsePresenceRows(data: unknown): PagePresencePerson[] {
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const people: PagePresencePerson[] = [];
  for (const row of data as Record<string, unknown>[]) {
    if (!row || typeof row.user_id !== "string" || !UUID.test(row.user_id) || seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    people.push({
      userId: row.user_id,
      name: typeof row.full_name === "string" ? row.full_name.slice(0, 200) : "",
      editing: row.editing === true,
    });
  }
  return people;
}

/**
 * Who to show, the reader excluded: editors first, then by name, so the list
 * does not jump around as heartbeats arrive.
 */
export function othersOnPage(people: PagePresencePerson[], me: string): PagePresencePerson[] {
  return people
    .filter((person) => person.userId !== me)
    .sort((a, b) => {
      if (a.editing !== b.editing) return a.editing ? -1 : 1;
      return a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
    });
}
