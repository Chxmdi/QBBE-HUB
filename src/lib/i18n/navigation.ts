import type { CreateAction } from "@/config/create-actions";
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
  "/forms": "nav.items.forms",
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
  "/signatures": "nav.items.signatures",
  "/crm": "nav.items.relationships",
  "/reports": "nav.items.reports",
  "/documents": "nav.items.documents",
  "/finance/receipts": "nav.items.receipts",
  "/finance/ledger": "nav.items.ledger",
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

const CREATE_KEYS: Record<string, MessageKey> = {
  "/my-work?create=task": "topbar.create.task",
  "/requests?create=1": "topbar.create.proposal",
  "/projects?create=1": "topbar.create.project",
  "/programs?create=1": "topbar.create.program",
  "/meetings?create=1": "topbar.create.meeting",
  "/events?create=1": "topbar.create.event",
  "/channels?create=1": "topbar.create.channel",
  "/crm?create=organization": "topbar.create.crmOrganization",
  "/crm?create=contact": "topbar.create.crmContact",
  "/crm?create=follow-up": "topbar.create.crmFollowUp",
  "/channels?create=announcement": "topbar.create.announcement",
};

/** "New task", "Nouvelle tâche": the whole phrase, since French agrees in gender. */
export function createActionLabel(t: TranslateFn, action: CreateAction): string {
  const key = CREATE_KEYS[action.href];
  return key ? t(key) : `New ${action.label.toLowerCase()}`;
}

export function navGroupLabel(t: TranslateFn, group: Pick<NavGroup, "label">): string {
  const key = GROUP_KEYS[group.label];
  return key ? t(key) : group.label;
}
