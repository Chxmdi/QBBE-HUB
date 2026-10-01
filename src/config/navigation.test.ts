import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_SWITCHES,
  CLASSIC_GROUP_LABEL,
  MOBILE_TAB_GROUPS_V2,
  MOBILE_TAB_HREFS,
  NAV_GROUPS,
  NAV_GROUPS_V2,
  NAV_SWITCH_KEYS,
  NO_SWITCHES,
  mobileTabs,
  navGroupsFor,
  navHref,
  visibleNav,
  type NavSwitches,
} from "@/config/navigation";
import { workspaceOsFlagKeys } from "@/lib/feature-flags";
import { createTranslator } from "@/lib/i18n/translate";
import { navGroupLabel, navItemLabel } from "@/lib/i18n/navigation";

/**
 * The navigation catalogue (U12): every entry opens a page that exists, has
 * a name in both languages, appears once per group, and the phone tabs are
 * drawn from the same menu as the sidebar. The consolidated grouping lists
 * exactly the screens the module grouping does, so turning `wos_home` on
 * regroups the menu and never drops or adds a route.
 */

const ADMIN = { isAdmin: true, isStaff: true };
const STAFF = { isAdmin: false, isStaff: true };
const VOLUNTEER = { isAdmin: false, isStaff: false };
const ROLES = [ADMIN, STAFF, VOLUNTEER];

const V1_SWITCHES: NavSwitches = { ...ALL_SWITCHES, wos_home: false };
const SWITCH_SETS: NavSwitches[] = [
  NO_SWITCHES,
  ALL_SWITCHES,
  V1_SWITCHES,
  ...NAV_SWITCH_KEYS.map((key) => ({ [key]: true }) as NavSwitches),
];

/** Every route with a page.tsx under src/app, with the route groups ("(workspace)") removed. */
function routes(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string, route: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path, name.startsWith("(") && name.endsWith(")") ? route : `${route}/${name}`);
      } else if (name === "page.tsx") {
        found.add(route || "/");
      }
    }
  };
  walk(join(process.cwd(), "src", "app"), "");
  return found;
}

const hrefs = (groups: { items: { href: string }[] }[]) => groups.flatMap((g) => g.items.map((i) => i.href));

// Names written the same in both languages.
const SAME_IN_BOTH = new Set(["Budgets", "Documents", "Messages", "Signatures", "Pages", "Communication"]);

describe("every navigation entry", () => {
  const pages = routes();
  const items = [...NAV_GROUPS, ...NAV_GROUPS_V2].flatMap((g) => g.items);

  it("opens a page that exists under src/app", () => {
    expect(existsSync(join(process.cwd(), "src", "app"))).toBe(true);
    for (const item of items) expect(pages.has(item.href), `${item.href} has no page.tsx`).toBe(true);
  });

  it("is named in English and in French", () => {
    const en = createTranslator("en");
    const fr = createTranslator("fr-CA");
    for (const item of items) {
      expect(navItemLabel(en, item), item.href).not.toBe("");
      expect(navItemLabel(fr, item), item.href).not.toBe("");
      if (!SAME_IN_BOTH.has(item.label)) expect(navItemLabel(fr, item), item.href).not.toBe(navItemLabel(en, item));
    }
    for (const group of [...NAV_GROUPS, ...NAV_GROUPS_V2]) {
      expect(navGroupLabel(en, group), group.label).not.toBe("");
      expect(navGroupLabel(fr, group), group.label).not.toBe("");
      if (!SAME_IN_BOTH.has(group.label)) expect(navGroupLabel(fr, group), group.label).not.toBe(navGroupLabel(en, group));
    }
    expect(navGroupLabel(fr, { label: CLASSIC_GROUP_LABEL })).toBe("Écrans classiques");
  });

  it("appears once within its group, in both groupings and in every rendered menu", () => {
    for (const group of [...NAV_GROUPS, ...NAV_GROUPS_V2]) {
      const seen = hrefs([group]);
      expect(new Set(seen).size, group.label).toBe(seen.length);
    }
    for (const role of ROLES) {
      for (const switches of SWITCH_SETS) {
        for (const group of visibleNav(role, switches)) {
          const seen = hrefs([group]);
          expect(new Set(seen).size, group.label).toBe(seen.length);
        }
      }
    }
  });
});

describe("the consolidated grouping", () => {
  it("lists exactly the screens the module grouping does, no route added or dropped", () => {
    expect(hrefs(NAV_GROUPS_V2).sort()).toEqual(hrefs(NAV_GROUPS).sort());
    expect(hrefs(NAV_GROUPS_V2).length).toBe(hrefs(NAV_GROUPS).length);
  });

  it("uses the same entry objects, so access, switches and replacements cannot drift", () => {
    const byHref = new Map(NAV_GROUPS.flatMap((g) => g.items).map((i) => [i.href, i]));
    for (const item of NAV_GROUPS_V2.flatMap((g) => g.items)) expect(byHref.get(item.href)).toBe(item);
  });

  it("is selected by wos_home alone", () => {
    expect(navGroupsFor(NO_SWITCHES)).toBe(NAV_GROUPS);
    expect(navGroupsFor(V1_SWITCHES)).toBe(NAV_GROUPS);
    expect(navGroupsFor({ wos_home: true })).toBe(NAV_GROUPS_V2);
    expect(visibleNav(ADMIN, { wos_home: true }).map((g) => g.label)).toEqual([
      "Home", "My Work", "Communication", "Programs", "More", CLASSIC_GROUP_LABEL,
    ]);
    expect(NAV_GROUPS_V2.map((g) => g.label)).toEqual(["Home", "My Work", "Pages", "Data", "Communication", "Programs", "More", "Setup"]);
  });

  it("keeps each replacement right after the screen it replaces", () => {
    for (const group of NAV_GROUPS_V2) {
      const list = group.items;
      for (const [index, item] of list.entries()) {
        if (item.replaces) expect(list[index - 1]?.href, `${item.href} follows ${item.replaces}`).toBe(item.replaces);
      }
    }
  });

  it("gathers the builders and administration tools under Setup", () => {
    const setup = NAV_GROUPS_V2.find((g) => g.label === "Setup")!;
    expect(hrefs([setup])).toEqual([
      "/builder", "/collab/layouts", "/workflows", "/api-tokens", "/upkeep", "/spaces/admin", "/spaces/roles", "/spaces/publish",
    ]);
    expect(setup.items.every((i) => i.access !== "member")).toBe(true);
  });

  it("shows the meetings index beside the classic meetings list while its switch is on", () => {
    const on = hrefs(visibleNav(VOLUNTEER, { wos_home: true, wos_meetings_v2: true }));
    expect(on).toContain("/meetings");
    expect(on).toContain("/meetings-v2");
    expect(hrefs(visibleNav(VOLUNTEER, { wos_home: true }))).not.toContain("/meetings-v2");
    expect(hrefs(visibleNav(VOLUNTEER, { wos_meetings_v2: true }))).toContain("/meetings-v2");
    expect(hrefs(visibleNav(VOLUNTEER))).not.toContain("/meetings-v2");
  });
});

describe("the phone tabs", () => {
  it("are a subset of the sidebar for every role and every set of switches", () => {
    for (const role of ROLES) {
      for (const switches of SWITCH_SETS) {
        const groups = visibleNav(role, switches);
        const shown = new Set(hrefs(groups));
        for (const tab of mobileTabs(groups, switches)) {
          expect(shown.has(tab.item.href), tab.item.href).toBe(true);
          if (tab.group) expect(groups).toContain(tab.group);
        }
      }
    }
  });

  it("are Home, My Work, Channels and Calendar before the consolidated menu, each following its replacement", () => {
    for (const switches of [NO_SWITCHES, V1_SWITCHES]) {
      const tabs = mobileTabs(visibleNav(VOLUNTEER, switches), switches);
      expect(tabs.map((t) => t.item.href)).toEqual(MOBILE_TAB_HREFS.map((href) => navHref(href, switches)));
      expect(tabs.every((t) => t.group === undefined)).toBe(true);
    }
    expect(mobileTabs(visibleNav(VOLUNTEER, V1_SWITCHES), V1_SWITCHES).map((t) => t.item.href)).toEqual([
      "/", "/lenses/my-work", "/channels", "/lenses/calendar",
    ]);
  });

  it("are Home, My Work, Pages and Communication with the consolidated menu, keeping the live counts", () => {
    const tabs = mobileTabs(visibleNav(VOLUNTEER, ALL_SWITCHES), ALL_SWITCHES);
    expect(tabs.map((t) => t.group?.label)).toEqual(MOBILE_TAB_GROUPS_V2.map((t) => t.group));
    expect(tabs.map((t) => t.item.href)).toEqual(["/home", "/lenses/my-work", "/pages", "/inbox"]);
    expect(tabs.map((t) => t.item.badge)).toEqual([undefined, "myWork", undefined, "inbox"]);
  });

  it("name groups the consolidated menu has", () => {
    for (const tab of MOBILE_TAB_GROUPS_V2) {
      expect(NAV_GROUPS_V2.find((g) => g.label === tab.group)?.items.map((i) => i.href), tab.group).toContain(tab.href);
    }
  });

  it("never name a group after a screen it does not open: no Pages tab while Pages is off", () => {
    const switches: NavSwitches = { wos_home: true, wos_spaces: true };
    const tabs = mobileTabs(visibleNav(VOLUNTEER, switches), switches);
    expect(tabs.map((t) => t.group?.label)).toEqual(["Home", "My Work", "Communication"]);
  });

  it("leave out a group with nothing to show rather than point at a hidden page", () => {
    const switches: NavSwitches = { wos_home: true };
    const tabs = mobileTabs(visibleNav(VOLUNTEER, switches), switches);
    expect(tabs.map((t) => t.group?.label)).toEqual(["Home", "My Work", "Communication"]);
    expect(tabs.map((t) => t.item.href)).toEqual(["/home", "/my-work", "/inbox"]);
  });

  it("mark the staff menu the same way", () => {
    const tabs = mobileTabs(visibleNav(STAFF, ALL_SWITCHES), ALL_SWITCHES);
    expect(tabs.map((t) => t.group?.label)).toEqual(MOBILE_TAB_GROUPS_V2.map((t) => t.group));
  });
});

describe("the switch list", () => {
  it("names every Workspace OS switch the server knows, so a menu entry can use any of them", () => {
    expect([...NAV_SWITCH_KEYS].sort()).toEqual([...workspaceOsFlagKeys].sort());
  });
});
