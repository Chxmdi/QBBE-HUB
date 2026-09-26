import type { NavGroup, NavItem } from "@/config/navigation";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

/**
 * Translations for `src/config/navigation.ts`, looked up by href.
 *
 * Kept beside the catalogue rather than inside the navigation config so that
 * file stays a plain list other work can add to without touching languages.
 * An entry missing here falls back to the config's English label, so a new
 * page is never nameless, only untranslated until it is added.
 */
const ITEM_KEYS: Record<string, MessageKey> = {
  "/": "nav.items.home",
  "/my-work": "nav.items.myWork",
  "/board": "nav.items.board",
  "/requests": "nav.items.requests",
  "/projects": "nav.items.projects",
  "/programs": "nav.items.programs",
  "/inbox": "nav.items.inbox",
  "/channels": "nav.items.channels",
  "/messages": "nav.items.messages",
  "/saved": "nav.items.saved",
  "/announcements": "nav.items.announcements",
  "/calendar": "nav.items.calendar",
  "/schedule": "nav.items.schedule",
  "/meetings": "nav.items.meetings",
  "/events": "nav.items.events",
  "/crm": "nav.items.relationships",
  "/reports": "nav.items.reports",
  "/documents": "nav.items.documents",
  "/people": "nav.items.people",
  "/admin": "nav.items.admin",
};

const GROUP_KEYS: Record<string, MessageKey> = {
  Work: "nav.groups.work",
  Communication: "nav.groups.communication",
  Organization: "nav.groups.organization",
};

export function navItemLabel(t: TranslateFn, item: Pick<NavItem, "href" | "label">): string {
  const key = ITEM_KEYS[item.href];
  return key ? t(key) : item.label;
}

export function navGroupLabel(t: TranslateFn, group: Pick<NavGroup, "label">): string {
  const key = GROUP_KEYS[group.label];
  return key ? t(key) : group.label;
}
