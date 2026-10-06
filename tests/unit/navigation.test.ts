import { describe, expect, it } from "vitest";
import {
  ALL_SWITCHES,
  CLASSIC_GROUP_LABEL,
  NAV_GROUPS,
  NAV_SWITCH_KEYS,
  NO_SWITCHES,
  activeNavHref,
  isUnder,
  navHref,
  visibleNav,
  type NavSwitches,
} from "@/config/navigation";
import { createTranslator } from "@/lib/i18n/translate";
import { navGroupLabel, navItemLabel } from "@/lib/i18n/navigation";
import { overriddenNavSwitches } from "@/lib/navigation-switches";

/**
 * The menus with Workspace OS switches (epic #199, plan §9). With every
 * switch off the menu is the one from before, entry for entry; with them on,
 * every new screen appears once, each replaced screen moves to "Classic
 * screens", and the role rules hold.
 */

const ADMIN = { isAdmin: true, isStaff: true };
const STAFF = { isAdmin: false, isStaff: true };
const VOLUNTEER = { isAdmin: false, isStaff: false };

/** The sidebar before Workspace OS, as the switched-off menu must stay. */
const MENU_BEFORE_WORKSPACE_OS = [
  {
    label: "Work",
    items: [
      ["/", "member"],
      ["/my-work", "member"],
      ["/board", "member"],
      ["/requests", "member"],
      ["/forms", "member"],
      ["/projects", "member"],
      ["/programs", "member"],
      ["/approvals", "staff"],
    ],
  },
  {
    label: "Communication",
    items: [
      ["/inbox", "member"],
      ["/channels", "member"],
      ["/messages", "member"],
      ["/saved", "member"],
      ["/announcements", "member"],
    ],
  },
  {
    label: "Organization",
    items: [
      ["/calendar", "member"],
      ["/schedule", "member"],
      ["/meetings", "member"],
      ["/events", "member"],
      ["/signatures", "member"],
      ["/crm", "staff"],
      ["/finance/ledger", "ledger"],
      ["/finance/budgets", "ledger"],
      ["/finance/sales-tax", "ledger"],
      ["/finance/bank", "ledger"],
      ["/reports", "staff"],
      ["/documents", "member"],
      ["/finance/receipts", "staff"],
      ["/finance/gifts", "ledger"],
      ["/finance/payables", "staff"],
      ["/finance/payroll", "ledger"],
      ["/people", "member"],
      ["/admin", "admin"],
    ],
  },
] as const;

/** Every switched screen, with its switch and the access it needs. */
const NEW_SCREENS: Record<string, { on: NavSwitches[keyof NavSwitches] extends boolean | undefined ? keyof NavSwitches : never; access: "member" | "staff" | "admin" }> = {
  "/home": { on: "wos_home", access: "member" },
  "/home/world": { on: "wos_home", access: "member" },
  "/home/commands": { on: "wos_home", access: "member" },
  "/lenses/my-work": { on: "wos_lenses", access: "member" },
  "/lenses/board": { on: "wos_lenses", access: "member" },
  "/lenses/calendar": { on: "wos_lenses", access: "member" },
  "/lenses": { on: "wos_lenses", access: "member" },
  "/lenses/table": { on: "wos_lenses", access: "member" },
  "/lenses/timeline": { on: "wos_lenses", access: "member" },
  "/lenses/gallery": { on: "wos_lenses", access: "member" },
  "/lenses/feed": { on: "wos_lenses", access: "member" },
  "/lenses/dashboard": { on: "wos_lenses", access: "member" },
  "/lenses/find": { on: "wos_lenses", access: "member" },
  "/insight/dashboards": { on: "wos_lenses", access: "member" },
  "/insight/operations": { on: "wos_lenses", access: "member" },
  "/insight/graph": { on: "wos_lenses", access: "member" },
  "/insight/map": { on: "wos_lenses", access: "member" },
  "/insight/process": { on: "wos_lenses", access: "member" },
  "/insight/what-if": { on: "wos_lenses", access: "member" },
  "/forms-v2": { on: "wos_forms_v2", access: "member" },
  "/capture": { on: "wos_capture", access: "member" },
  "/goals": { on: "wos_goals", access: "member" },
  "/following": { on: "wos_objects", access: "member" },
  "/apps": { on: "wos_objects", access: "member" },
  "/templates-v2": { on: "wos_objects", access: "member" },
  "/builder": { on: "wos_objects", access: "staff" },
  "/upkeep": { on: "wos_objects", access: "staff" },
  "/pages": { on: "wos_pages", access: "member" },
  "/spaces": { on: "wos_spaces", access: "member" },
  "/spaces/admin": { on: "wos_spaces", access: "admin" },
  "/spaces/roles": { on: "wos_spaces", access: "admin" },
  "/spaces/publish": { on: "wos_public_pages", access: "admin" },
  "/collab/layouts": { on: "wos_editor", access: "staff" },
  "/collab/trash": { on: "wos_editor", access: "member" },
  "/offline": { on: "wos_offline", access: "member" },
  "/m": { on: "wos_mobile", access: "member" },
  "/workflows": { on: "wos_workflows_v2", access: "admin" },
  "/api-tokens": { on: "wos_workflows_v2", access: "staff" },
  "/meetings-v2": { on: "wos_meetings_v2", access: "member" },
};

/**
 * Every switch but `wos_home`, which also selects the consolidated grouping
 * (U12): the module groups from before, with every module on.
 */
const V1_SWITCHES: NavSwitches = { ...ALL_SWITCHES, wos_home: false };

/** Old screen, and the new one that takes its place in the menu. */
const REPLACEMENTS: [string, string][] = [
  ["/", "/home"],
  ["/my-work", "/lenses/my-work"],
  ["/board", "/lenses/board"],
  ["/forms", "/forms-v2"],
  ["/calendar", "/lenses/calendar"],
];

const hrefs = (groups: { items: { href: string }[] }[]) => groups.flatMap((g) => g.items.map((i) => i.href));
const skeleton = (groups: { label: string; items: { href: string; access: string }[] }[]) =>
  groups.map((g) => ({ label: g.label, items: g.items.map((i) => [i.href, i.access]) }));

describe("visibleNav with every switch off", () => {
  // Ledger screens: administrators, and staff made ledger readers (none of these roles).
  const before = (role: { isAdmin: boolean; isStaff: boolean }) =>
    MENU_BEFORE_WORKSPACE_OS.map((g) => ({
      label: g.label,
      items: g.items.filter(([, access]) =>
        access === "admin" || access === "ledger" ? role.isAdmin : access === "staff" ? role.isStaff : true,
      ),
    })).filter((g) => g.items.length > 0);

  it.each([
    ["admin", ADMIN],
    ["staff", STAFF],
    ["volunteer", VOLUNTEER],
  ])("is the menu from before Workspace OS for %s, with or without a switches argument", (_, role) => {
    expect(skeleton(visibleNav(role))).toEqual(before(role));
    expect(skeleton(visibleNav(role, NO_SWITCHES))).toEqual(before(role));
    expect(skeleton(visibleNav(role, Object.fromEntries(NAV_SWITCH_KEYS.map((k) => [k, false]))))).toEqual(before(role));
  });

  it("shows no switched screen and no Classic group", () => {
    const shown = hrefs(visibleNav(ADMIN));
    for (const href of Object.keys(NEW_SCREENS)) expect(shown, href).not.toContain(href);
    expect(visibleNav(ADMIN).map((g) => g.label)).not.toContain(CLASSIC_GROUP_LABEL);
    expect(visibleNav(ADMIN).flatMap((g) => g.items).some((i) => i.classic)).toBe(false);
  });

  it("keeps the live counts on My Work and Inbox", () => {
    const items = visibleNav(ADMIN).flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/my-work")?.badge).toBe("myWork");
    expect(items.find((i) => i.href === "/inbox")?.badge).toBe("inbox");
    expect(items.filter((i) => i.badge)).toHaveLength(2);
  });

  it("points the mobile tabs at the old screens", () => {
    for (const [old] of REPLACEMENTS) expect(navHref(old)).toBe(old);
  });
});

describe("visibleNav with every switch on", () => {
  it("shows every new screen exactly once for an admin, and every old screen stays reachable", () => {
    const shown = hrefs(visibleNav(ADMIN, ALL_SWITCHES));
    for (const href of Object.keys(NEW_SCREENS)) {
      expect(shown.filter((h) => h === href), href).toHaveLength(1);
    }
    for (const group of MENU_BEFORE_WORKSPACE_OS) {
      for (const [href] of group.items) expect(shown.filter((h) => h === href), href).toHaveLength(1);
    }
    expect(new Set(shown).size).toBe(shown.length);
  });

  it("lists every switched entry in the config exactly once, so nothing is forgotten here", () => {
    const configured = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.switch).map((i) => i.href).sort();
    expect(configured).toEqual(Object.keys(NEW_SCREENS).sort());
    for (const item of NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.switch)) {
      expect(NEW_SCREENS[item.href], item.href).toEqual({ on: item.switch, access: item.access });
    }
  });

  it("puts each replacement in its old screen's place and moves the old screen to Classic screens", () => {
    const groups = visibleNav(ADMIN, V1_SWITCHES);
    const classic = groups[groups.length - 1];
    expect(classic.label).toBe(CLASSIC_GROUP_LABEL);
    expect(classic.items.map((i) => i.href)).toEqual(REPLACEMENTS.map(([old]) => old).filter((old) => old !== "/"));
    expect(classic.items.every((i) => i.classic === true)).toBe(true);

    const work = groups.find((g) => g.label === "Work")!;
    expect(work.items.map((i) => i.href)).toEqual([
      "/",
      "/lenses/my-work",
      "/lenses/board",
      "/capture",
      "/requests",
      "/forms-v2",
      "/projects",
      "/programs",
      "/goals",
      "/approvals",
    ]);
    const organization = groups.find((g) => g.label === "Organization")!;
    expect(organization.items[0].href).toBe("/lenses/calendar");
    expect(organization.items.map((i) => i.href)).not.toContain("/calendar");
    expect(organization.items.map((i) => i.href)).toContain("/meetings-v2");
    for (const [old, replacement] of REPLACEMENTS) expect(navHref(old, ALL_SWITCHES)).toBe(replacement);
    for (const [old, replacement] of REPLACEMENTS) {
      expect(navHref(old, V1_SWITCHES)).toBe(old === "/" ? "/" : replacement);
    }
  });

  it("with the consolidated menu, every replaced screen sits under Classic screens, Home first", () => {
    const groups = visibleNav(ADMIN, ALL_SWITCHES);
    const classic = groups[groups.length - 1];
    expect(classic.label).toBe(CLASSIC_GROUP_LABEL);
    expect(classic.items.map((i) => i.href)).toEqual(["/", "/my-work", "/board", "/calendar", "/forms"]);
  });

  it("moves the My Work count to the lens version and never shows a count twice", () => {
    const items = visibleNav(ADMIN, ALL_SWITCHES).flatMap((g) => g.items);
    expect(items.find((i) => i.href === "/lenses/my-work")?.badge).toBe("myWork");
    expect(items.find((i) => i.href === "/my-work")?.badge).toBeUndefined();
    expect(items.filter((i) => i.badge === "myWork")).toHaveLength(1);
    expect(items.filter((i) => i.badge === "inbox")).toHaveLength(1);
  });

  it("keeps the group order: the three groups from before, then the new ones, then Classic screens", () => {
    expect(visibleNav(ADMIN, V1_SWITCHES).map((g) => g.label)).toEqual([
      "Work",
      "Communication",
      "Organization",
      "Lenses",
      "Insight",
      "Workspace",
      "Setup",
      CLASSIC_GROUP_LABEL,
    ]);
  });

  it("with wos_home on, the groups are the consolidated ones, then Classic screens", () => {
    expect(visibleNav(ADMIN, ALL_SWITCHES).map((g) => g.label)).toEqual([
      "Home",
      "My Work",
      "Pages",
      "Data",
      "Communication",
      "Programs",
      "More",
      "Setup",
      CLASSIC_GROUP_LABEL,
    ]);
  });

  it.each([
    ["staff", STAFF, "staff"],
    ["volunteer", VOLUNTEER, "member"],
  ])("shows %s only the screens their role allows", (_, role, level) => {
    const shown = hrefs(visibleNav(role, ALL_SWITCHES));
    for (const [href, screen] of Object.entries(NEW_SCREENS)) {
      const allowed = screen.access === "member" || (screen.access === "staff" && level === "staff");
      expect(shown.includes(href), href).toBe(allowed);
    }
    // The old staff and admin rules are untouched.
    expect(shown).not.toContain("/admin");
    expect(shown.includes("/approvals")).toBe(level === "staff");
  });

  it("volunteers see no Setup group and no admin-only replacement side effects", () => {
    const labels = visibleNav(VOLUNTEER, ALL_SWITCHES).map((g) => g.label);
    expect(labels).not.toContain("Setup");
    expect(labels).toContain(CLASSIC_GROUP_LABEL);
  });
});

describe("visibleNav with one switch on", () => {
  it.each(NAV_SWITCH_KEYS)("%s shows only that module's screens", (key) => {
    const shown = hrefs(visibleNav(ADMIN, { [key]: true }));
    for (const [href, screen] of Object.entries(NEW_SCREENS)) {
      expect(shown.includes(href), `${href} with ${key}`).toBe(screen.on === key);
    }
  });

  it("replaces only what that switch replaces", () => {
    const groups = visibleNav(ADMIN, { wos_forms_v2: true });
    const classic = groups[groups.length - 1];
    expect(classic.label).toBe(CLASSIC_GROUP_LABEL);
    expect(classic.items.map((i) => i.href)).toEqual(["/forms"]);
    const work = groups.find((g) => g.label === "Work")!;
    expect(work.items.map((i) => i.href)).toEqual([
      "/",
      "/my-work",
      "/board",
      "/requests",
      "/forms-v2",
      "/projects",
      "/programs",
      "/approvals",
    ]);
    expect(navHref("/my-work", { wos_forms_v2: true })).toBe("/my-work");
  });
});

describe("labels", () => {
  it.each(["en", "fr-CA"] as const)("name every entry and group in %s, and classic screens apart from their replacements", (locale) => {
    const t = createTranslator(locale);
    const groups = visibleNav(ADMIN, ALL_SWITCHES);
    const seen = new Map<string, string>();
    for (const group of groups) {
      expect(navGroupLabel(t, group), group.label).not.toBe("");
      for (const item of group.items) {
        const label = navItemLabel(t, item);
        expect(label, item.href).not.toBe("");
        // Two entries may not read the same: a palette result or a screen
        // reader would not tell them apart.
        expect(seen.get(label), `${label}: ${seen.get(label)} and ${item.href}`).toBeUndefined();
        seen.set(label, item.href);
      }
    }
    const classic = groups[groups.length - 1].items[0];
    expect(navItemLabel(t, classic)).toBe(locale === "en" ? "Home (classic)" : "Accueil (classique)");
    expect(navItemLabel(t, { ...classic, classic: false })).toBe(locale === "en" ? "Home" : "Accueil");
  });

  it("translates every new group and entry into French", () => {
    const en = createTranslator("en");
    const fr = createTranslator("fr-CA");
    const same = new Set(["Communication", "Pages"]);
    for (const group of visibleNav(ADMIN, ALL_SWITCHES)) {
      if (!same.has(group.label)) expect(navGroupLabel(fr, group), group.label).not.toBe(navGroupLabel(en, group));
      for (const item of group.items) {
        if (!["Budgets", "Documents", "Messages", "Signatures", "Pages"].includes(item.label)) {
          expect(navItemLabel(fr, item), item.href).not.toBe(navItemLabel(en, item));
        }
      }
    }
  });
});

describe("the current entry", () => {
  it("is the page itself or a page under it, never a sibling that shares a prefix", () => {
    expect(isUnder("/forms-v2", "/forms")).toBe(false);
    expect(isUnder("/forms/abc", "/forms")).toBe(true);
    expect(isUnder("/forms", "/forms")).toBe(true);
    expect(isUnder("/", "/")).toBe(true);
    expect(isUnder("/board", "/")).toBe(false);
  });

  it("is the most specific entry", () => {
    const groups = visibleNav(ADMIN, ALL_SWITCHES);
    expect(activeNavHref(groups, "/lenses/board")).toBe("/lenses/board");
    expect(activeNavHref(groups, "/lenses/board?lens=1".split("?")[0])).toBe("/lenses/board");
    expect(activeNavHref(groups, "/lenses")).toBe("/lenses");
    expect(activeNavHref(groups, "/lenses/abc")).toBe("/lenses");
    expect(activeNavHref(groups, "/home/world")).toBe("/home/world");
    expect(activeNavHref(groups, "/home/projects/1")).toBe("/home");
    expect(activeNavHref(groups, "/")).toBe("/");
    expect(activeNavHref(groups, "/m/inbox")).toBe("/m");
    expect(activeNavHref(groups, "/nowhere")).toBeNull();
  });

  it("matches the old rule for the old menu", () => {
    const groups = visibleNav(ADMIN);
    for (const group of groups) {
      for (const item of group.items) {
        expect(activeNavHref(groups, item.href)).toBe(item.href);
        expect(activeNavHref(groups, `${item.href === "/" ? "" : item.href}/child`)).toBe(item.href === "/" ? null : item.href);
      }
    }
  });
});

describe("the WORKSPACE_OS_FLAGS override", () => {
  it("turns on the named switches, every one with `all`, and nothing when unset", () => {
    expect(overriddenNavSwitches(undefined).size).toBe(0);
    expect(overriddenNavSwitches("")).toEqual(new Set());
    expect([...overriddenNavSwitches("all")].sort()).toEqual([...NAV_SWITCH_KEYS].sort());
    expect(overriddenNavSwitches(" wos_lenses , WOS_GOALS,typo")).toEqual(new Set(["wos_lenses", "wos_goals"]));
  });
});

describe("ledger screens in the menus (audit M6)", () => {
  const LEDGER = ["/finance/ledger", "/finance/budgets", "/finance/sales-tax", "/finance/bank", "/finance/gifts", "/finance/payroll"];
  const hrefs = (role: Parameters<typeof visibleNav>[0]) =>
    visibleNav(role, ALL_SWITCHES).flatMap((group) => group.items.map((item) => item.href));

  it("hides them from staff who are not ledger readers, who would only meet 'You do not have access'", () => {
    const staff = hrefs(STAFF);
    for (const href of LEDGER) expect(staff, href).not.toContain(href);
    expect(staff).toEqual(expect.arrayContaining(["/finance/receipts", "/finance/payables"]));
  });

  it("lists them for ledger readers and administrators", () => {
    const reader = hrefs({ ...STAFF, canReadLedger: true });
    const admin = hrefs(ADMIN);
    for (const href of LEDGER) {
      expect(reader, href).toContain(href);
      expect(admin, href).toContain(href);
    }
  });

  it("never lists them for a volunteer, even one flagged as a reader", () => {
    const volunteer = hrefs({ ...VOLUNTEER, canReadLedger: true });
    for (const href of LEDGER) expect(volunteer, href).not.toContain(href);
  });
});
