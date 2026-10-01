import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Navigation consolidation (U12): with `wos_home` on, the sidebar shows the
 * consolidated groups (Home, My Work, Pages, Data, Communication, Programs,
 * More, Setup) and keeps every replaced screen under "Classic screens"; the
 * phone bar becomes Home, My Work, Pages, Communication and More, works at
 * 320px from the keyboard, and everything reads in French. The meetings
 * index (`/meetings-v2`, behind `wos_meetings_v2`) is reachable from both.
 *
 * Every test here needs the switches on, so each is tagged for the
 * switches-on CI rows only.
 */

const STAFF = "qa-staff@example.com";
const GROUPS = ["Home", "My Work", "Pages", "Data", "Communication", "Programs", "More", "Setup", "Classic screens"];
const GROUPS_FR = ["Accueil", "Mon travail", "Pages", "Données", "Communication", "Programmes", "Plus", "Configuration", "Écrans classiques"];
const CLASSIC = ["Home (classic)", "My Work (classic)", "Board (classic)", "Calendar (classic)", "Forms (classic)"];

/** The group labels of the sidebar, in the order they are shown, ignoring the channel and program shortcuts after them. */
async function groupLabels(nav: Locator, known: string[]): Promise<string[]> {
  const texts = await nav.locator("p").allTextContents();
  return texts.map((text) => text.trim()).filter((text) => known.includes(text)).slice(0, known.length);
}

/** The page fits the width: nothing scrolls sideways. */
async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? "");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A phone tab's accessible name. The My Work and Communication tabs carry the
 * live count as a badge ("Communication 3 open items") whenever it is above
 * zero, and the specs that ran before this one on the same database decide
 * it, so the name allows the badge. `seedUnread` makes the Communication
 * badge certain, and the tests check it is there.
 */
const BADGE = { en: "open items", fr: "éléments ouverts" } as const;
const tabName = (label: string, badge: string = BADGE.en) =>
  new RegExp(`^${escape(label)}(?:\\s+\\d+\\+?\\s+${escape(badge)})?$`);
const withBadge = (label: string, badge: string = BADGE.en) =>
  new RegExp(`^${escape(label)}\\s+\\d+\\+?\\s+${escape(badge)}$`);

/** One unread notification for the staff member, so the inbox count is above zero. */
const seedUnread = (stamp: number) =>
  sql(`
    insert into public.notification (user_id, organization_id, category, title, body, dedupe_key)
    select u.id, m.organization_id, 'mention', 'Nav unread ${stamp}', 'Counts on the Communication tab', 'nav-v2-${stamp}'
    from auth.users u join public.organization_membership m on m.user_id = u.id
    where u.email = '${STAFF}';
  `);

const setStaffLocale = (locale: string | null) =>
  sql(`update public.user_profile set locale = ${locale ? `'${locale}'` : "null"} where email = '${STAFF}';`);

function seedMeetings(stamp: number): { upcoming: string; past: string } {
  const insert = (title: string, when: string) =>
    sql(`
      insert into public.meeting (organization_id, title, organizer_id, starts_at)
      select m.organization_id, '${title}', u.id, ${when}
      from auth.users u join public.organization_membership m on m.user_id = u.id
      where u.email = '${STAFF}'
      returning id;
    `);
  return {
    upcoming: insert(`Nav upcoming ${stamp}`, "now() + interval '2 days'"),
    // The newest past meeting, so it is always inside the "Recent" window.
    past: insert(`Nav recent ${stamp}`, "now() - interval '1 minute'"),
  };
}

test.afterEach(() => setStaffLocale(null));
test.afterAll(() => {
  sql(`delete from public.meeting where title like 'Nav upcoming %' or title like 'Nav recent %';`);
  sql(`delete from public.notification where dedupe_key like 'nav-v2-%';`);
});

test("the sidebar shows the new groups and keeps classic screens [switches on]", async ({ page }) => {
  const stamp = Date.now();
  seedMeetings(stamp);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, "staff");
  await page.goto("/home");

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  expect(await groupLabels(nav, GROUPS)).toEqual(GROUPS);
  // The module groups are gone from the sidebar.
  for (const old of ["Work", "Organization", "Lenses", "Insight", "Workspace"]) {
    await expect(nav.locator("p").filter({ hasText: new RegExp(`^${old}$`) })).toHaveCount(0);
  }
  // Every replaced screen is still reachable, named apart from its replacement.
  for (const name of CLASSIC) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  // The replacements sit in the new groups and are the current ones.
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/home");
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "My Work", exact: true })).toHaveAttribute("href", "/lenses/my-work");
  // Builders and administration tools are under Setup for a staff member.
  for (const name of ["Blueprints", "Page layouts", "API access tokens", "Workspace upkeep"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  // Workflows and the space administration are admin-only and stay hidden from staff.
  await expect(nav.getByRole("link", { name: "Workflows", exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);

  // The meetings index beside the classic meetings list.
  await expect(nav.getByRole("link", { name: "Meetings", exact: true })).toHaveAttribute("href", "/meetings");
  const index = nav.getByRole("link", { name: "Meeting notes", exact: true });
  await expect(index).toHaveAttribute("href", "/meetings-v2");
  await index.click();
  await page.waitForURL("**/meetings-v2");
  await expect(page.getByRole("heading", { level: 1, name: "Meeting notes" })).toBeVisible();
  await expect(index).toHaveAttribute("aria-current", "page");
  const upcoming = page.getByRole("region", { name: "Coming up" });
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(upcoming.getByRole("link", { name: `Nav upcoming ${stamp}` })).toHaveAttribute("href", /\/meetings-v2\/[0-9a-f-]+$/);
  await expect(recent.getByRole("link", { name: `Nav recent ${stamp}` })).toHaveAttribute("href", /\/meetings-v2\/[0-9a-f-]+$/);
  await expect(page.getByRole("link", { name: "Classic meetings list" })).toHaveAttribute("href", "/meetings");
  await upcoming.getByRole("link", { name: `Nav upcoming ${stamp}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Nav upcoming ${stamp}` })).toBeVisible();
});

test("the menu works at 320 px from the keyboard [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  seedUnread(Date.now());
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page, "staff");
  await page.goto("/home");
  expect(await fitsWidth(page)).toBe(true);

  const primary = page.getByRole("navigation", { name: "Primary" });
  const tabs = ["Home", "My Work", "Pages", "Communication"];
  for (const name of tabs) await expect(primary.getByRole("link", { name: tabName(name) })).toBeVisible();
  // The unread count rides on the Communication tab.
  await expect(primary.getByRole("link", { name: withBadge("Communication") })).toBeVisible();
  await expect(primary.getByRole("link")).toHaveCount(tabs.length);
  const more = primary.getByRole("button", { name: "More destinations" });
  await expect(more).toBeVisible();
  await expect(primary.getByRole("link", { name: tabName("Home") })).toHaveAttribute("aria-current", "page");
  await expect(primary.getByRole("link", { name: tabName("Communication") })).toHaveAttribute("href", "/inbox");

  // Focus order across the bar: Home, My Work, Pages, Communication, More.
  await primary.getByRole("link", { name: tabName("Home") }).focus();
  for (const name of tabs.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(primary.getByRole("link", { name: tabName(name) })).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();

  // Enter on More opens the full menu, focus moves inside, Escape returns it.
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(drawer).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
  expect(await groupLabels(drawer, GROUPS)).toEqual(GROUPS);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(more).toBeFocused();

  // Tab reaches the meetings index inside the menu, and Enter opens it.
  await page.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  let reached = false;
  for (let step = 0; step < 120 && !reached; step += 1) {
    await page.keyboard.press("Tab");
    reached = (await focusedText(page)) === "Meeting notes";
  }
  expect(reached, "Tab reaches the Meeting notes entry").toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/meetings-v2");
  await expect(page.getByRole("heading", { level: 1, name: "Meeting notes" })).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  // A group tab is current on any of its screens.
  await expect(primary.getByRole("link", { name: tabName("Communication") })).toHaveAttribute("aria-current", "page");
  await expect(primary.getByRole("link", { name: tabName("Home") })).not.toHaveAttribute("aria-current", "page");

  // Enter on a tab navigates.
  await primary.getByRole("link", { name: tabName("My Work") }).focus();
  await page.keyboard.press("Enter");
  await page.waitForURL("**/lenses/my-work**");
  await expect(primary.getByRole("link", { name: tabName("My Work") })).toHaveAttribute("aria-current", "page");
  expect(await fitsWidth(page)).toBe(true);
});

test("the menu reads in French [switches on]", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  seedUnread(Date.now());
  await signIn(page, "staff");
  // The profile is the record; the cookie is what the server reads first.
  setStaffLocale("fr-CA");
  const { origin } = new URL(page.url());
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.goto("/home");

  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav).toBeVisible();
  expect(await groupLabels(nav, GROUPS_FR)).toEqual(GROUPS_FR);
  for (const name of ["Accueil (classique)", "Mon travail (classique)", "Tableau (classique)", "Calendrier (classique)", "Formulaires (classique)"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(nav.getByRole("link", { name: "Notes de réunion", exact: true })).toHaveAttribute("href", "/meetings-v2");
  await expect(nav.getByRole("link", { name: "Plans de l’espace", exact: true })).toBeVisible();
  // No English group or entry name survives in the menu.
  const text = await nav.innerText();
  expect(text).not.toMatch(/\b(My Work|Data|More|Setup|Classic screens|Meeting notes|Blueprints|Page layouts|Workspace upkeep|Saved lenses|Find)\b/);
  for (const english of GROUPS) {
    if (!GROUPS_FR.includes(english)) expect(text.split("\n").map((line) => line.trim())).not.toContain(english);
  }

  await nav.getByRole("link", { name: "Notes de réunion", exact: true }).click();
  await page.waitForURL("**/meetings-v2");
  await expect(page.getByRole("heading", { level: 1, name: "Notes de réunion" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "À venir" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Récentes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Liste classique des réunions" })).toBeVisible();

  // The phone bar in French.
  await page.setViewportSize({ width: 320, height: 640 });
  const primary = page.getByRole("navigation", { name: "Principale" });
  for (const name of ["Accueil", "Mon travail", "Pages", "Communication"]) {
    await expect(primary.getByRole("link", { name: tabName(name, BADGE.fr) })).toBeVisible();
  }
  await expect(primary.getByRole("link", { name: withBadge("Communication", BADGE.fr) })).toBeVisible();
  await expect(primary.getByRole("button", { name: "Autres destinations" })).toHaveText("Plus");
  expect(await fitsWidth(page)).toBe(true);
});
