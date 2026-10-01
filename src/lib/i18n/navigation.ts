import type { CreateAction } from "@/config/create-actions";
import type { NavGroup, VisibleNavItem } from "@/config/navigation";
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
  "/approvals": "nav.items.approvals",
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
  "/finance/bank": "nav.items.bank",
  "/finance/payables": "nav.items.payables",
  "/finance/sales-tax": "nav.items.salesTax",
  "/finance/gifts": "nav.items.gifts",
  "/finance/budgets": "nav.items.budgets",
  "/finance/payroll": "nav.items.payroll",
  "/people": "nav.items.people",
  "/admin": "nav.items.admin",
  // Workspace OS (epic #199). A replacement shares its old screen's name.
  "/home": "nav.items.home",
  "/home/world": "nav.items.myWorld",
  "/home/commands": "nav.items.commands",
  "/lenses/my-work": "nav.items.myWork",
  "/lenses/board": "nav.items.boardLens",
  "/lenses/calendar": "nav.items.calendar",
  "/forms-v2": "nav.items.forms",
  "/capture": "nav.items.capture",
  "/goals": "nav.items.goals",
  "/following": "nav.items.following",
  "/lenses": "nav.items.savedLenses",
  "/lenses/table": "nav.items.table",
  "/lenses/timeline": "nav.items.timeline",
  "/lenses/gallery": "nav.items.gallery",
  "/lenses/feed": "nav.items.feed",
  "/lenses/dashboard": "nav.items.dashboards",
  "/lenses/find": "nav.items.find",
  "/insight/dashboards": "nav.items.insightDashboards",
  "/insight/operations": "nav.items.operations",
  "/insight/graph": "nav.items.relationshipGraph",
  "/insight/map": "nav.items.map",
  "/insight/process": "nav.items.howWorkFlows",
  "/insight/what-if": "nav.items.whatIf",
  "/pages": "nav.items.pages",
  "/spaces": "nav.items.spaces",
  "/apps": "nav.items.apps",
  "/templates-v2": "nav.items.templates",
  "/builder": "nav.items.blueprints",
  "/collab/layouts": "nav.items.pageLayouts",
  "/collab/trash": "nav.items.trash",
  "/upkeep": "nav.items.upkeep",
  "/offline": "nav.items.offline",
  "/m": "nav.items.phone",
  "/spaces/admin": "nav.items.accessAndSignIn",
  "/spaces/roles": "nav.items.roles",
  "/spaces/publish": "nav.items.publicPages",
  "/workflows": "nav.items.workflows",
  "/api-tokens": "nav.items.apiTokens",
  "/meetings-v2": "nav.items.meetingNotes",
};

const GROUP_KEYS: Record<string, MessageKey> = {
  Work: "nav.groups.work",
  Communication: "nav.groups.communication",
  Organization: "nav.groups.organization",
  Lenses: "nav.groups.lenses",
  Insight: "nav.groups.insight",
  Workspace: "nav.groups.workspace",
  Setup: "nav.groups.setup",
  "Classic screens": "nav.groups.classic",
  // The consolidated menu (U12), while wos_home is on.
  Home: "nav.groups.home",
  "My Work": "nav.groups.myWork",
  Pages: "nav.groups.pages",
  Data: "nav.groups.data",
  Programs: "nav.groups.programs",
  More: "nav.groups.more",
};

/**
 * An old screen kept beside its replacement (plan §9) is named apart from
 * it, "Board (classic)", so the two never read the same in the sidebar, the
 * palette or to a screen reader.
 */
export function navItemLabel(
  t: TranslateFn,
  item: Pick<VisibleNavItem, "href" | "label" | "classic">,
): string {
  const key = ITEM_KEYS[item.href];
  const label = key ? t(key) : item.label;
  return item.classic ? t("nav.classicLabel", { label }) : label;
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
