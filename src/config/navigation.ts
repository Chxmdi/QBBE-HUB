import {
  Activity,
  AppWindow,
  BarChart3,
  Banknote,
  BellRing,
  Bookmark,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChartGantt,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  DraftingCompass,
  FileText,
  FolderKanban,
  FolderOpen,
  FileSignature,
  Gauge,
  Gift,
  Glasses,
  Globe,
  Handshake,
  Home,
  Inbox,
  KanbanSquare,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  LockKeyhole,
  Map,
  Megaphone,
  MessageSquare,
  NotebookPen,
  Orbit,
  PanelsTopLeft,
  Percent,
  MessagesSquare,
  PiggyBank,
  Presentation,
  Receipt,
  Route,
  Rss,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Table2,
  Target,
  Terminal,
  Trash2,
  Users,
  Wallet,
  Waypoints,
  WifiOff,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * The Workspace OS switches the menus read (epic #199, plan §9). The keys
 * mirror `feature_flag.key`: the first eleven are `workspaceOsFlagKeys` in
 * src/lib/feature-flags.ts, the rest were added by the S5b modules
 * (migration 20261105110000) and read through their own helpers until
 * integration folds them into the shared list.
 */
export const NAV_SWITCH_KEYS = [
  "wos_objects",
  "wos_spaces",
  "wos_pages",
  "wos_editor",
  "wos_lenses",
  "wos_home",
  "wos_capture",
  "wos_workflows_v2",
  "wos_forms_v2",
  "wos_public_pages",
  "wos_offline",
  "wos_goals",
  "wos_mobile",
] as const;

export type NavSwitchKey = (typeof NAV_SWITCH_KEYS)[number];

/** Which switches are on for this request. A missing key reads as off. */
export type NavSwitches = Partial<Record<NavSwitchKey, boolean>>;

/** Every switch off: the menu exactly as it was before Workspace OS. */
export const NO_SWITCHES: NavSwitches = Object.freeze({});

/** Every switch on, for tests and the staging override. */
export const ALL_SWITCHES: NavSwitches = Object.freeze(
  Object.fromEntries(NAV_SWITCH_KEYS.map((key) => [key, true])),
) as NavSwitches;

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Minimum access: 'member' (everyone), 'staff', 'admin'. */
  access: "member" | "staff" | "admin";
  /**
   * Shown only while this switch is on. Entries without one are the menu as
   * it was before Workspace OS and never move.
   */
  switch?: NavSwitchKey;
  /**
   * The old screen this entry stands in for while its switch is on. The old
   * entry then moves to the "Classic screens" group so it stays reachable
   * for one release (plan §9, step 5); it is never removed here.
   */
  replaces?: string;
  /** Which live count this entry carries, if any (Part IV §5.2). */
  badge?: "myWork" | "inbox";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** A nav entry as the menus render it. */
export interface VisibleNavItem extends NavItem {
  /** An old screen kept reachable beside its replacement. */
  classic?: boolean;
}

export interface VisibleNavGroup {
  label: string;
  items: VisibleNavItem[];
}

/** The group the replaced screens move to while their replacements are on. */
export const CLASSIC_GROUP_LABEL = "Classic screens";

/**
 * Sidebar structure: Work, Communication, Organization (Part IV §5.2), then
 * the Workspace OS groups, which are empty while their switches are off.
 * Volunteers see the simplified member-level subset (P0-VOL-02).
 *
 * A switched entry that replaces an old screen sits right after it, so it
 * takes that screen's place in the menu when the switch is on.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Work",
    items: [
      { label: "Home", href: "/", icon: Home, access: "member" },
      { label: "Home", href: "/home", icon: Home, access: "member", switch: "wos_home", replaces: "/" },
      { label: "My World", href: "/home/world", icon: Orbit, access: "member", switch: "wos_home" },
      { label: "My Work", href: "/my-work", icon: ClipboardList, access: "member", badge: "myWork" },
      {
        label: "My Work",
        href: "/lenses/my-work",
        icon: ClipboardList,
        access: "member",
        switch: "wos_lenses",
        replaces: "/my-work",
        badge: "myWork",
      },
      { label: "Board", href: "/board", icon: KanbanSquare, access: "member" },
      { label: "Board", href: "/lenses/board", icon: KanbanSquare, access: "member", switch: "wos_lenses", replaces: "/board" },
      { label: "Capture", href: "/capture", icon: NotebookPen, access: "member", switch: "wos_capture" },
      // Member-level on purpose: intake that only staff can reach is not
      // intake. Policies decide whether you see the queue or only your own.
      { label: "Requests", href: "/requests", icon: ClipboardCheck, access: "member" },
      { label: "Forms", href: "/forms", icon: ClipboardPen, access: "member" },
      { label: "Forms", href: "/forms-v2", icon: ClipboardPen, access: "member", switch: "wos_forms_v2", replaces: "/forms" },
      { label: "Projects", href: "/projects", icon: FolderKanban, access: "member" },
      { label: "Programs", href: "/programs", icon: Layers, access: "member" },
      { label: "Goals", href: "/goals", icon: Target, access: "member", switch: "wos_goals" },
      { label: "Approvals", href: "/approvals", icon: ClipboardCheck, access: "staff" },
    ],
  },
  {
    label: "Communication",
    items: [
      { label: "Inbox", href: "/inbox", icon: Inbox, access: "member", badge: "inbox" },
      { label: "Channels", href: "/channels", icon: MessagesSquare, access: "member" },
      { label: "Messages", href: "/messages", icon: MessageSquare, access: "member" },
      { label: "Saved", href: "/saved", icon: Bookmark, access: "member" },
      {
        label: "Announcements",
        href: "/announcements",
        icon: Megaphone,
        access: "member",
      },
      { label: "Following", href: "/following", icon: BellRing, access: "member", switch: "wos_objects" },
    ],
  },
  {
    label: "Organization",
    items: [
      { label: "Calendar", href: "/calendar", icon: CalendarDays, access: "member" },
      { label: "Calendar", href: "/lenses/calendar", icon: CalendarDays, access: "member", switch: "wos_lenses", replaces: "/calendar" },
      { label: "Master Schedule", href: "/schedule", icon: CalendarRange, access: "member" },
      { label: "Meetings", href: "/meetings", icon: Presentation, access: "member" },
      { label: "Events", href: "/events", icon: Building2, access: "member" },
      { label: "Signatures", href: "/signatures", icon: FileSignature, access: "member" },
      { label: "Relationships", href: "/crm", icon: Handshake, access: "staff" },
      { label: "Ledger", href: "/finance/ledger", icon: Landmark, access: "staff" },
      { label: "Budgets", href: "/finance/budgets", icon: PiggyBank, access: "staff" },
      { label: "GST and QST", href: "/finance/sales-tax", icon: Percent, access: "staff" },
      { label: "Bank", href: "/finance/bank", icon: Landmark, access: "staff" },
      { label: "Reports", href: "/reports", icon: BarChart3, access: "staff" },
      { label: "Documents", href: "/documents", icon: FolderOpen, access: "member" },
      { label: "Receipts", href: "/finance/receipts", icon: Receipt, access: "staff" },
      { label: "Gifts and grants", href: "/finance/gifts", icon: Gift, access: "staff" },
      { label: "Bills & invoices", href: "/finance/payables", icon: Wallet, access: "staff" },
      { label: "Payroll", href: "/finance/payroll", icon: Banknote, access: "staff" },
      { label: "People", href: "/people", icon: Users, access: "member" },
      { label: "Admin", href: "/admin", icon: Settings, access: "admin" },
    ],
  },
  {
    // Lenses (M8): the saved ones, one entry per kind that opens without a
    // saved lens, and the new search page.
    label: "Lenses",
    items: [
      { label: "Saved lenses", href: "/lenses", icon: Glasses, access: "member", switch: "wos_lenses" },
      { label: "Table", href: "/lenses/table", icon: Table2, access: "member", switch: "wos_lenses" },
      { label: "Timeline", href: "/lenses/timeline", icon: ChartGantt, access: "member", switch: "wos_lenses" },
      { label: "Gallery", href: "/lenses/gallery", icon: LayoutGrid, access: "member", switch: "wos_lenses" },
      { label: "Feed", href: "/lenses/feed", icon: Rss, access: "member", switch: "wos_lenses" },
      { label: "Dashboards", href: "/lenses/dashboard", icon: LayoutDashboard, access: "member", switch: "wos_lenses" },
      { label: "Find", href: "/lenses/find", icon: Search, access: "member", switch: "wos_lenses" },
    ],
  },
  {
    // Insight (S4) shares the lenses switch (src/features/insight/gate.ts).
    label: "Insight",
    items: [
      { label: "Insight dashboards", href: "/insight/dashboards", icon: Gauge, access: "member", switch: "wos_lenses" },
      { label: "Operations", href: "/insight/operations", icon: Activity, access: "member", switch: "wos_lenses" },
      { label: "Relationship graph", href: "/insight/graph", icon: Waypoints, access: "member", switch: "wos_lenses" },
      { label: "Map", href: "/insight/map", icon: Map, access: "member", switch: "wos_lenses" },
      { label: "How work flows", href: "/insight/process", icon: Route, access: "member", switch: "wos_lenses" },
      { label: "What-if timeline", href: "/insight/what-if", icon: CalendarClock, access: "member", switch: "wos_lenses" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { label: "Pages", href: "/pages", icon: FileText, access: "member", switch: "wos_pages" },
      { label: "Spaces", href: "/spaces", icon: Boxes, access: "member", switch: "wos_spaces" },
      { label: "Commands", href: "/home/commands", icon: Terminal, access: "member", switch: "wos_home" },
      { label: "Apps", href: "/apps", icon: AppWindow, access: "member", switch: "wos_objects" },
      { label: "Templates", href: "/templates-v2", icon: LayoutTemplate, access: "member", switch: "wos_objects" },
      // The builder itself answers not-found to non-staff.
      { label: "Blueprints", href: "/builder", icon: DraftingCompass, access: "staff", switch: "wos_objects" },
      { label: "Page layouts", href: "/collab/layouts", icon: PanelsTopLeft, access: "staff", switch: "wos_editor" },
      { label: "Trash", href: "/collab/trash", icon: Trash2, access: "member", switch: "wos_editor" },
      { label: "Workspace upkeep", href: "/upkeep", icon: Wrench, access: "staff", switch: "wos_objects" },
      { label: "Work offline", href: "/offline", icon: WifiOff, access: "member", switch: "wos_offline" },
      { label: "Phone screens", href: "/m", icon: Smartphone, access: "member", switch: "wos_mobile" },
    ],
  },
  {
    // Administration of the new layer. Each page redirects or answers
    // not-found below its own role; the menu mirrors that.
    label: "Setup",
    items: [
      { label: "Access and sign-in", href: "/spaces/admin", icon: LockKeyhole, access: "admin", switch: "wos_spaces" },
      { label: "Roles", href: "/spaces/roles", icon: ShieldCheck, access: "admin", switch: "wos_spaces" },
      { label: "Public pages", href: "/spaces/publish", icon: Globe, access: "admin", switch: "wos_public_pages" },
      { label: "Workflows", href: "/workflows", icon: Workflow, access: "admin", switch: "wos_workflows_v2" },
      { label: "API access tokens", href: "/api-tokens", icon: KeyRound, access: "staff", switch: "wos_workflows_v2" },
    ],
  },
];

function allowed(item: NavItem, role: { isAdmin: boolean; isStaff: boolean }): boolean {
  return item.access === "admin" ? role.isAdmin : item.access === "staff" ? role.isStaff : true;
}

/**
 * The menu for one person and one request. With no switches (or all off) it
 * is the menu from before Workspace OS, entry for entry. With a switch on,
 * that module's entries appear, each old screen a new one replaces moves to
 * the "Classic screens" group at the end, and the replacement takes its
 * place. Every screen appears once.
 */
export function visibleNav(
  role: { isAdmin: boolean; isStaff: boolean },
  switches: NavSwitches = NO_SWITCHES,
): VisibleNavGroup[] {
  const on = (item: NavItem) => !item.switch || switches[item.switch] === true;
  const replaced = new Set(
    NAV_GROUPS.flatMap((group) => group.items)
      .filter((item) => item.replaces && on(item) && allowed(item, role))
      .map((item) => item.replaces as string),
  );
  const classic: VisibleNavItem[] = [];

  const groups: VisibleNavGroup[] = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => {
      if (!allowed(item, role) || !on(item)) return false;
      if (replaced.has(item.href)) {
        // The replacement carries the live count; the old entry is a plain
        // link, so the number is never shown twice.
        classic.push({ ...item, badge: undefined, classic: true });
        return false;
      }
      return true;
    }),
  })).filter((group) => group.items.length > 0);

  if (classic.length > 0) groups.push({ label: CLASSIC_GROUP_LABEL, items: classic });
  return groups;
}

/**
 * Where a menu entry points for this request: the replacement while its
 * switch is on, else the screen itself. The mobile tabs use it so Home, My
 * Work and Calendar follow the sidebar.
 */
export function navHref(href: string, switches: NavSwitches = NO_SWITCHES): string {
  const replacement = NAV_GROUPS.flatMap((group) => group.items).find(
    (item) => item.replaces === href && item.switch && switches[item.switch] === true,
  );
  return replacement?.href ?? href;
}

/** Whether `pathname` is `href` or a page under it ("/forms" is not under "/forms-v2"). */
export function isUnder(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one entry to mark as the current page: the longest `href` the path
 * sits under, so "/lenses/board" lights Board rather than Board and Saved
 * lenses together.
 */
export function activeNavHref(groups: { items: { href: string }[] }[], pathname: string): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (isUnder(pathname, item.href) && (best === null || item.href.length > best.length)) {
        best = item.href;
      }
    }
  }
  return best;
}
