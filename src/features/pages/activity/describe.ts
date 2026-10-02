import type { PagesKey, PagesT } from "@/features/pages/i18n";

/**
 * Wave 2 C2: one activity entry as a sentence in the reader's language.
 *
 * The rows come from public.activity_entry (written by triggers, read under
 * RLS); the names they point at (people, properties, relations, records,
 * pages, roles) are looked up separately, as the reader, and handed in. A
 * name the reader cannot see is simply missing and falls back to a neutral
 * word ("Someone", "a record"), never to an id.
 */

export interface ActivityRow {
  id: string;
  seq: number;
  event: string;
  actor_kind: string;
  actor_id: string | null;
  subject: string | null;
  details: Record<string, unknown>;
  occurred_at: string;
}

export interface Bilingual {
  en: string;
  fr: string;
}

export interface ActivityNames {
  people: Map<string, string>;
  teams: Map<string, string>;
  /** Property labels by key. */
  properties: Map<string, Bilingual>;
  /** Relation type labels by key. */
  relations: Map<string, Bilingual>;
  /** Titles of records and pages by id. */
  titles: Map<string, string>;
}

export const emptyNames = (): ActivityNames => ({
  people: new Map(),
  teams: new Map(),
  properties: new Map(),
  relations: new Map(),
  titles: new Map(),
});

export type Lang = "en" | "fr";

const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "codeBlock",
  "table",
  "image",
  "video",
  "audio",
  "file",
  "callout",
  "divider",
] as const;

const ORG_ROLES = ["owner", "admin", "leadership_viewer", "staff", "volunteer", "guest"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** Text cut to a readable length on one line. */
export function clip(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * A property value as short text: plain values as they are, custom values
 * ({ value_text: … }) by their one filled column, lists joined.
 */
export function formatValue(value: unknown, t: PagesT, names: ActivityNames): string {
  if (value === null || value === undefined || value === "") return t("units.c2.values.empty");
  if (typeof value === "boolean") return t(value ? "units.c2.values.yes" : "units.c2.values.no");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return clip(names.people.get(value) ?? names.titles.get(value) ?? value, 60);
  if (Array.isArray(value)) {
    return value.length === 0 ? t("units.c2.values.empty") : clip(value.map((item) => formatValue(item, t, names)).join(", "), 60);
  }
  if (isRecord(value)) {
    const filled = Object.entries(value).filter(([key, item]) => key.startsWith("value_") && item !== null && item !== undefined);
    if (filled.length === 0) return t("units.c2.values.empty");
    return formatValue(filled[0][1], t, names);
  }
  return t("units.c2.values.empty");
}

function actorName(row: ActivityRow, t: PagesT, names: ActivityNames): string {
  switch (row.actor_kind) {
    case "person":
      return (row.actor_id && names.people.get(row.actor_id)) || t("units.c2.actors.someone");
    case "team":
      return t("units.c2.actors.team");
    case "automation":
      return t("units.c2.actors.automation");
    case "integration":
      return t("units.c2.actors.integration");
    default:
      return t("units.c2.actors.system");
  }
}

function blockLabel(type: unknown, t: PagesT): string {
  const known = (BLOCK_TYPES as readonly string[]).includes(String(type));
  return t((known ? `units.c2.blocks.${String(type)}` : "units.c2.blocks.other") as PagesKey);
}

function roleName(role: unknown, lang: Lang): string {
  if (!isRecord(role)) return "?";
  return str(lang === "fr" ? role.name_fr : role.name_en) ?? str(role.name_en) ?? str(role.key) ?? "?";
}

function principalName(details: Record<string, unknown>, t: PagesT, names: ActivityNames): string {
  switch (details.principal_kind) {
    case "person": {
      const id = str(details.user_id);
      return (id && names.people.get(id)) || t("units.c2.principals.person");
    }
    case "team": {
      const id = str(details.team_id);
      const name = id ? names.teams.get(id) : undefined;
      return name ? t("units.c2.principals.team", { name }) : t("units.c2.principals.teamUnknown");
    }
    default: {
      const role = String(details.org_role ?? "");
      const label = (ORG_ROLES as readonly string[]).includes(role) ? t(`units.c2.roles.${role}` as PagesKey) : role;
      return t("units.c2.principals.orgRole", { role: label });
    }
  }
}

function blockSentence(row: ActivityRow, verb: "Added" | "Removed" | "Moved" | "Updated", t: PagesT, actor: string): string {
  const count = row.details.count;
  if (typeof count === "number") return t(`units.c2.events.blocks${verb}` as PagesKey, { actor, count });
  const text = str(row.details.text);
  const block = blockLabel(row.details.type, t);
  return text
    ? t(`units.c2.events.block${verb}` as PagesKey, { actor, block, text: clip(text) })
    : t(`units.c2.events.block${verb}Empty` as PagesKey, { actor, block });
}

/** The sentence for one entry, starting with who acted. */
export function describeActivity(row: ActivityRow, names: ActivityNames, t: PagesT, lang: Lang): string {
  const actor = actorName(row, t, names);
  const details = isRecord(row.details) ? row.details : {};
  const entry = { ...row, details };
  switch (row.event) {
    case "page.created":
      return t("units.c2.events.pageCreated", { actor });
    case "page.updated": {
      const changes = Array.isArray(details.changes) ? details.changes.filter(isRecord) : [];
      const fields = changes.map((change) => String(change.field));
      if (fields.length === 1 && fields[0] === "title") {
        return t("units.c2.events.pageRenamed", { actor, title: clip(String(changes[0].after ?? "")) });
      }
      const labels = fields
        .filter((field) => field === "title" || field === "icon" || field === "cover")
        .map((field) => t(`units.c2.fields.${field}` as PagesKey));
      const list =
        labels.length <= 1
          ? (labels[0] ?? t("units.c2.fields.title"))
          : t("units.c2.fields.list", { first: labels.slice(0, -1).join(", "), last: labels[labels.length - 1] });
      return t("units.c2.events.pageUpdated", { actor, fields: list });
    }
    case "page.moved": {
      const parent = str(details.after);
      if (!parent) return t("units.c2.events.pageMovedTop", { actor });
      return t("units.c2.events.pageMoved", { actor, parent: names.titles.get(parent) ?? t("page.untitled") });
    }
    case "page.archived":
      return t("units.c2.events.pageArchived", { actor });
    case "page.deleted":
      return t("units.c2.events.pageDeleted", { actor });
    case "page.restored":
      return t("units.c2.events.pageRestored", { actor });
    case "record.created":
      return t("units.c2.events.recordCreated", { actor });
    case "record.archived":
      return t("units.c2.events.recordArchived", { actor });
    case "record.deleted":
      return t("units.c2.events.recordDeleted", { actor });
    case "record.restored":
      return t("units.c2.events.recordRestored", { actor });
    case "block.added":
      return blockSentence(entry, "Added", t, actor);
    case "block.removed":
      return blockSentence(entry, "Removed", t, actor);
    case "block.moved":
      return blockSentence(entry, "Moved", t, actor);
    case "block.updated":
      return blockSentence(entry, "Updated", t, actor);
    case "property.updated": {
      const change = Array.isArray(details.changes) && isRecord(details.changes[0]) ? details.changes[0] : {};
      const key = str(change.property) ?? row.subject ?? "";
      const label = names.properties.get(key);
      const property = label ? (lang === "fr" ? label.fr : label.en) : key;
      const empty = (value: unknown) =>
        value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
      if (empty(change.after)) return t("units.c2.events.propertyCleared", { actor, property });
      const after = formatValue(change.after, t, names);
      if (empty(change.before)) return t("units.c2.events.propertySet", { actor, property, after });
      return t("units.c2.events.propertyChanged", { actor, property, before: formatValue(change.before, t, names), after });
    }
    case "relation.linked":
    case "relation.unlinked": {
      const otherId = str(details.other);
      const other = (otherId && names.titles.get(otherId)) || t("units.c2.events.otherRecord");
      const key = str(details.relation) ?? "";
      const label = names.relations.get(key);
      const relation = label ? (lang === "fr" ? label.fr : label.en) : key;
      return t(row.event === "relation.linked" ? "units.c2.events.relationLinked" : "units.c2.events.relationUnlinked", {
        actor,
        other: clip(other),
        relation,
      });
    }
    case "permission.changed":
      if (details.field === "visibility") {
        return t(details.after === "private" ? "units.c2.events.madePrivate" : "units.c2.events.madeWorkspace", { actor });
      }
      return t("units.c2.events.permissionChanged", {
        actor,
        principal: principalName(details, t, names),
        before: roleName(details.before_role, lang),
        after: roleName(details.role, lang),
      });
    case "permission.granted":
      return t("units.c2.events.permissionGranted", {
        actor,
        principal: principalName(details, t, names),
        role: roleName(details.role, lang),
      });
    case "permission.revoked":
      return t("units.c2.events.permissionRevoked", {
        actor,
        principal: principalName(details, t, names),
        role: roleName(details.role, lang),
      });
    case "version.saved": {
      const label = str(details.label);
      return label
        ? t("units.c2.events.versionSaved", { actor, label: clip(label) })
        : t("units.c2.events.versionSavedUnnamed", { actor });
    }
    case "version.restored":
      return t("units.c2.events.versionRestored", { actor });
    case "comment.added":
      return t("units.c2.events.commentAdded", { actor });
    default:
      return t("units.c2.events.other", { actor, event: row.event });
  }
}

/** Ids and keys an entry names, so the loader fetches each name once. */
export function referencedIds(rows: ActivityRow[]) {
  const people = new Set<string>();
  const teams = new Set<string>();
  const properties = new Set<string>();
  const relations = new Set<string>();
  const titles = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const maybeId = (value: unknown) => {
    if (typeof value === "string" && uuid.test(value)) {
      people.add(value);
      titles.add(value);
    }
  };
  for (const row of rows) {
    const details = isRecord(row.details) ? row.details : {};
    if (row.actor_kind === "person" && row.actor_id) people.add(row.actor_id);
    if (row.event.startsWith("permission.")) {
      if (str(details.user_id)) people.add(String(details.user_id));
      if (str(details.team_id)) teams.add(String(details.team_id));
    }
    if (row.event === "page.moved" && str(details.after)) titles.add(String(details.after));
    if (row.event.startsWith("relation.")) {
      if (str(details.other)) titles.add(String(details.other));
      if (str(details.relation)) relations.add(String(details.relation));
    }
    if (row.event === "property.updated" && Array.isArray(details.changes)) {
      for (const change of details.changes.filter(isRecord)) {
        if (str(change.property)) properties.add(String(change.property));
        maybeId(change.before);
        maybeId(change.after);
      }
    }
  }
  return { people, teams, properties, relations, titles };
}
