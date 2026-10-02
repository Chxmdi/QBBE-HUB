import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/config";
import { createPagesT } from "@/features/pages/i18n";
import {
  describeActivity,
  emptyNames,
  propertyNameKey,
  referencedIds,
  type ActivityNames,
  type ActivityRow,
  type Bilingual,
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

interface PropertyRow {
  type_id: string;
  key: string;
  kind: string;
  name_en: string;
  name_fr: string;
  options: unknown;
}

/** A select or status property's choice labels ({ choices: [{ key, label: { en, fr } }] }). */
function choiceLabels(options: unknown): Map<string, Bilingual> {
  const labels = new Map<string, Bilingual>();
  const choices = (options as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) return labels;
  for (const choice of choices as { key?: unknown; label?: { en?: unknown; fr?: unknown } }[]) {
    if (typeof choice?.key !== "string") continue;
    const en = typeof choice.label?.en === "string" ? choice.label.en : choice.key;
    labels.set(choice.key, { en, fr: typeof choice.label?.fr === "string" ? choice.label.fr : en });
  }
  return labels;
}

/** The names entries point at, each read as the viewer (RLS decides). */
async function loadNames(db: Db, rows: ActivityRow[]): Promise<ActivityNames> {
  const names = emptyNames();
  const ids = referencedIds(rows);
  const list = (set: Set<string>) => [...set].slice(0, 200);
  // Property keys are unique per type only: read the types named first.
  const typeKeys = [...new Set([...ids.properties].map((name) => name.slice(0, name.indexOf(":"))))];
  const propertyKeys = [...new Set([...ids.properties].map((name) => name.slice(name.indexOf(":") + 1)))];
  const types = typeKeys.length
    ? (((await db.from("object_type").select("id, key").in("key", typeKeys)).data ?? []) as { id: string; key: string }[])
    : [];
  const typeKeyById = new Map(types.map((type) => [type.id, type.key]));
  const [people, teams, properties, relations, objects, pages] = await Promise.all([
    ids.people.size ? db.from("user_profile").select("id, full_name, email").in("id", list(ids.people)) : null,
    ids.teams.size ? db.from("team").select("id, name").in("id", list(ids.teams)) : null,
    types.length && propertyKeys.length
      ? db
          .from("property_definition")
          .select("type_id, key, kind, name_en, name_fr, options")
          .in("type_id", [...typeKeyById.keys()])
          .in("key", propertyKeys.slice(0, 200))
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
  for (const row of (properties?.data ?? []) as PropertyRow[]) {
    const typeKey = typeKeyById.get(row.type_id);
    if (!typeKey) continue;
    names.properties.set(propertyNameKey(typeKey, row.key), {
      en: row.name_en,
      fr: row.name_fr || row.name_en,
      kind: row.kind,
      choices: choiceLabels(row.options),
    });
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
    .select("id, seq, event, actor_kind, actor_id, subject, details, occurred_at, object_type")
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
  const zoned = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale, { ...options, timeZone });
    } catch {
      return new Intl.DateTimeFormat(locale, options);
    }
  };
  const format = zoned({ dateStyle: "medium", timeStyle: "short" });
  const dateTime = zoned({ dateStyle: "medium", timeStyle: "short" });
  const dateOnly = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  // A plain date has no zone (it is the same day everywhere); a date-time is
  // shown in the reader's zone.
  const formatDate = (value: string) => {
    const plain = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const date = new Date(plain ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(date.getTime())) return value;
    return (plain ? dateOnly : dateTime).format(date);
  };
  const items = shown.map((row) => ({
    id: row.id,
    text: describeActivity(row, { t, lang, names, formatDate }),
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
