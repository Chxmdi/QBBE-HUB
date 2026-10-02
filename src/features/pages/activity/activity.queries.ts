import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/config";
import { createPagesT } from "@/features/pages/i18n";
import {
  describeActivity,
  emptyNames,
  referencedIds,
  type ActivityNames,
  type ActivityRow,
} from "./describe";

/** One entry as the panel shows it: the sentence and when. */
export interface ActivityItem {
  id: string;
  text: string;
  /** ISO time, for <time dateTime>. */
  at: string;
  /** The time in the reader's language and time zone. */
  when: string;
}

/** Where the next (older) page starts: the last entry shown. */
export interface ActivityCursor {
  at: string;
  seq: number;
}

export type ActivityPage =
  | { ok: true; items: ActivityItem[]; next: ActivityCursor | null }
  | { ok: false };

export const ACTIVITY_PAGE_SIZE = 30;

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The names entries point at, each read as the viewer (RLS decides). */
async function loadNames(db: Db, rows: ActivityRow[]): Promise<ActivityNames> {
  const names = emptyNames();
  const ids = referencedIds(rows);
  const list = (set: Set<string>) => [...set].slice(0, 200);
  const [people, teams, properties, relations, objects, pages] = await Promise.all([
    ids.people.size ? db.from("user_profile").select("id, full_name, email").in("id", list(ids.people)) : null,
    ids.teams.size ? db.from("team").select("id, name").in("id", list(ids.teams)) : null,
    ids.properties.size
      ? db.from("property_definition").select("key, name_en, name_fr").in("key", list(ids.properties))
      : null,
    ids.relations.size
      ? db.from("relation_type").select("key, name_en, name_fr").in("key", list(ids.relations))
      : null,
    ids.titles.size ? db.from("object").select("id, title").in("id", list(ids.titles)) : null,
    ids.titles.size ? db.from("page").select("id, title").in("id", list(ids.titles)) : null,
  ]);
  for (const row of (people?.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
    const name = row.full_name?.trim() || row.email?.trim();
    if (name) names.people.set(row.id, name);
  }
  for (const row of (teams?.data ?? []) as { id: string; name: string }[]) names.teams.set(row.id, row.name);
  for (const row of (properties?.data ?? []) as { key: string; name_en: string; name_fr: string }[]) {
    names.properties.set(row.key, { en: row.name_en, fr: row.name_fr || row.name_en });
  }
  for (const row of (relations?.data ?? []) as { key: string; name_en: string; name_fr: string }[]) {
    names.relations.set(row.key, { en: row.name_en, fr: row.name_fr || row.name_en });
  }
  for (const row of [...(objects?.data ?? []), ...(pages?.data ?? [])] as { id: string; title: string }[]) {
    if (row.title?.trim()) names.titles.set(row.id, row.title.trim());
  }
  return names;
}

/**
 * One page of an object's activity, newest first, as sentences in the
 * reader's language. Read with the signed-in person's client, so the
 * activity_entry policy decides which entries exist for them.
 */
export async function loadActivityPage(
  objectId: string,
  locale: Locale,
  timeZone: string,
  before: ActivityCursor | null = null,
): Promise<ActivityPage> {
  const db = await createSupabaseServerClient();
  let query = db
    .from("activity_entry")
    .select("id, seq, event, actor_kind, actor_id, subject, details, occurred_at")
    .eq("object_id", objectId)
    .order("occurred_at", { ascending: false })
    .order("seq", { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE + 1);
  if (before) {
    query = query.or(`occurred_at.lt.${before.at},and(occurred_at.eq.${before.at},seq.lt.${before.seq})`);
  }
  const { data, error } = await query;
  if (error) return { ok: false };
  const rows = (data ?? []) as ActivityRow[];
  const shown = rows.slice(0, ACTIVITY_PAGE_SIZE);
  const names = await loadNames(db, shown);
  const t = createPagesT(locale);
  const lang = locale === "fr-CA" ? "fr" : "en";
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  } catch {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  }
  const items = shown.map((row) => ({
    id: row.id,
    text: describeActivity(row, names, t, lang),
    at: new Date(row.occurred_at).toISOString(),
    when: format.format(new Date(row.occurred_at)),
  }));
  const last = shown[shown.length - 1];
  return {
    ok: true,
    items,
    next: rows.length > ACTIVITY_PAGE_SIZE && last ? { at: last.occurred_at, seq: last.seq } : null,
  };
}
