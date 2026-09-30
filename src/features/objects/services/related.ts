import type { LocalizedText, Uuid } from "@/lib/objects/contracts";
import type { Locale } from "@/lib/i18n/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listRelations, type RelationFromObject } from "./relations";

export interface RelatedItem {
  id: Uuid;
  type: string;
  title: string;
  archived: boolean;
  /** Stored links can be removed as links; native ones change on the record. */
  stored: boolean;
}

export interface RelatedGroup {
  /** `${relationTypeKey}:${direction}`, stable for keys and test ids. */
  key: string;
  label: string;
  items: RelatedItem[];
}

export interface RelatedPanelData {
  groups: RelatedGroup[];
  total: number;
  /** Links whose other end the viewer cannot see. */
  hidden: number;
}

export interface RelationTypeNames {
  name: LocalizedText;
  reverseName: LocalizedText;
}

const pick = (text: LocalizedText, locale: Locale) => (locale === "fr-CA" ? text.fr : text.en);

/**
 * Groups one object's links for the Related panel: one group per relation
 * type and direction ("Contains", "Is in", "Blocks", "Is blocked by"), named
 * in the viewer's language, items sorted by title. A link whose other end
 * the viewer cannot read is counted as hidden, never shown.
 */
export function groupRelated(
  relations: RelationFromObject[],
  others: Map<Uuid, { title: string; archived: boolean }>,
  names: Map<string, RelationTypeNames>,
  locale: Locale,
  untitled: string,
): RelatedPanelData {
  const groups = new Map<string, RelatedGroup>();
  const seen = new Set<string>();
  let hidden = 0;

  for (const { relation, direction, other } of relations) {
    const found = others.get(other.id);
    if (!found) {
      hidden += 1;
      continue;
    }
    const key = `${relation.relationTypeKey}:${direction}`;
    if (seen.has(`${key}:${other.id}`)) continue;
    seen.add(`${key}:${other.id}`);

    let group = groups.get(key);
    if (!group) {
      const typeNames = names.get(relation.relationTypeKey);
      const label = typeNames
        ? pick(direction === "outgoing" ? typeNames.name : typeNames.reverseName, locale)
        : relation.relationTypeKey;
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push({
      id: other.id,
      type: other.type,
      title: found.title.trim() || untitled,
      archived: found.archived,
      stored: relation.source === "object_relation",
    });
  }

  const sorted = [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => Number(a.archived) - Number(b.archived) || a.title.localeCompare(b.title, locale)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  return { groups: sorted, total: sorted.reduce((sum, group) => sum + group.items.length, 0), hidden };
}

type Client = Pick<Awaited<ReturnType<typeof createSupabaseServerClient>>, "from">;

/** Everything the Related panel shows for one object, read as the viewer. */
export async function loadRelatedPanel(
  objectId: Uuid,
  organizationId: Uuid,
  locale: Locale,
  untitled: string,
  client?: Client,
): Promise<RelatedPanelData> {
  const supabase = client ?? (await createSupabaseServerClient());
  const relations = await listRelations(objectId, supabase);
  const otherIds = [...new Set(relations.map((relation) => relation.other.id))];

  const [objects, types] = await Promise.all([
    otherIds.length
      ? supabase.from("object").select("id, title, archived_at").in("id", otherIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("relation_type")
      .select("key, name_en, name_fr, reverse_name_en, reverse_name_fr")
      .eq("organization_id", organizationId),
  ]);

  const others = new Map<Uuid, { title: string; archived: boolean }>();
  for (const row of (objects.data ?? []) as { id: Uuid; title: string; archived_at: string | null }[]) {
    others.set(row.id, { title: row.title, archived: row.archived_at !== null });
  }
  const names = new Map<string, RelationTypeNames>();
  for (const row of (types.data ?? []) as {
    key: string;
    name_en: string;
    name_fr: string;
    reverse_name_en: string;
    reverse_name_fr: string;
  }[]) {
    names.set(row.key, {
      name: { en: row.name_en, fr: row.name_fr },
      reverseName: { en: row.reverse_name_en, fr: row.reverse_name_fr },
    });
  }
  return groupRelated(relations, others, names, locale, untitled);
}
