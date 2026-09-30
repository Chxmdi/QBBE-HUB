import { createClient } from "@supabase/supabase-js";
import type { Locale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicationRow, PublishedField, PublishedPage } from "./publication";

/**
 * The public page for a web address, read as a signed-out visitor with the
 * public key: only public.published_page, and only while the switch is on
 * (its read policy). Nothing else is ever read for a visitor.
 */
export async function getPublishedPage(slug: string): Promise<PublishedPage | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const visitor = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await visitor
    .from("published_page")
    .select("slug, title_en, title_fr, fields, published_at")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as PublishedPage;
}

export interface PublishSource {
  id: string;
  label: string;
}

/** Spaces (not private) and projects the admin can see, to choose from. */
export async function listPublishSources(locale: Locale): Promise<PublishSource[]> {
  const db = await createSupabaseServerClient();
  const [{ data: spaces }, { data: projects }] = await Promise.all([
    db.from("space").select("id, kind, name_en, name_fr").neq("kind", "private").is("archived_at", null),
    db.from("project").select("id, name").is("archived_at", null).order("name").limit(500),
  ]);
  return [
    ...((spaces ?? []) as { id: string; name_en: string; name_fr: string }[]).map((s) => ({
      id: s.id,
      label: locale === "fr-CA" ? s.name_fr : s.name_en,
    })),
    ...((projects ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name })),
  ];
}

export async function publicationCandidates(sourceId: string): Promise<PublishedField[] | null> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("publication_candidates", { object_id: sourceId });
  if (error || !Array.isArray(data)) return null;
  return data as PublishedField[];
}

export interface PublicationView extends PublicationRow {
  requesterName: string | null;
  preview: { title_en: string; title_fr: string; fields: PublishedField[] } | null;
}

/** Every publication in the organization, for owners and admins (RLS). */
export async function listPublications(): Promise<PublicationView[]> {
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("publication")
    .select("id, object_id, slug, fields, status, requested_by, requested_at, reviewed_at, review_note, unpublished_at")
    .order("requested_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not read publications: ${error.message}`);
  const rows = (data ?? []) as PublicationRow[];
  const people = [...new Set(rows.map((r) => r.requested_by).filter((id): id is string => Boolean(id)))];
  const [{ data: profiles }, previews] = await Promise.all([
    people.length ? db.from("user_profile").select("id, full_name").in("id", people) : Promise.resolve({ data: [] }),
    Promise.all(
      rows.map((row) =>
        row.status === "in_review"
          ? db.rpc("publication_preview", { publication_id: row.id }).then(({ data: preview }) => preview)
          : Promise.resolve(null),
      ),
    ),
  ]);
  const names = new Map(((profiles ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
  return rows.map((row, index) => ({
    ...row,
    requesterName: row.requested_by ? (names.get(row.requested_by) ?? null) : null,
    preview: (previews[index] as PublicationView["preview"]) ?? null,
  }));
}

/** Ids of what a member can see that is public now, for the "Public" badge. */
export async function publishedObjectIds(): Promise<Set<string>> {
  const db = await createSupabaseServerClient();
  const { data } = await db.rpc("published_object_ids");
  return new Set(((data ?? []) as string[]).filter((id) => typeof id === "string"));
}
