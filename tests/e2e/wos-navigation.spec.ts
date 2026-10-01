import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS in the menus (epic #199, plan §9): every new screen is in the
 * sidebar, the mobile tabs and the command palette while its switch is on,
 * by its name in English and in French, for staff and for volunteers; each
 * old screen a new one replaces stays reachable under "Classic screens"; and
 * with the switches off nothing new appears.
 *
 * Like every other Workspace OS spec, the switches are the rows in
 * `feature_flag`, flipped here on the one worker the suite runs on. The
 * server under test therefore runs without the WORKSPACE_OS_FLAGS override:
 * that override can only turn switches on, and the last test needs them off.
 * With every row on, the menu is exactly the one `WORKSPACE_OS_FLAGS=all`
 * produces (src/lib/navigation-switches.ts reads both the same way).
 */

const SWITCHES = [
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
];

const setSwitches = (on: boolean) =>
  sql(
    `update public.feature_flag set enabled = ${on} where organization_id is null and key = any(array[${SWITCHES.map((key) => `'${key}'`).join(",")}]);`,
  );

const NOT_FOUND = "Not found — or not yours to see";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

type Locale = "en" | "fr";
interface Screen {
  href: string;
  en: string;
  fr: string;
  access: "member" | "staff" | "admin";
}

/** Every new screen the menus carry, with its name in both languages. */
const NEW_SCREENS: Screen[] = [
  { href: "/home", en: "Home", fr: "Accueil", access: "member" },
  { href: "/home/world", en: "My World", fr: "Mon univers", access: "member" },
  { href: "/lenses/my-work", en: "My Work", fr: "Mon travail", access: "member" },
  { href: "/lenses/board", en: "Board", fr: "Tableau kanban", access: "member" },
  { href: "/capture", en: "Capture", fr: "Saisie rapide", access: "member" },
  { href: "/forms-v2", en: "Forms", fr: "Formulaires", access: "member" },
  { href: "/goals", en: "Goals", fr: "Objectifs", access: "member" },
  { href: "/following", en: "Following", fr: "Suivis", access: "member" },
  { href: "/lenses/calendar", en: "Calendar", fr: "Calendrier", access: "member" },
  { href: "/lenses", en: "Saved lenses", fr: "Vues enregistrées", access: "member" },
  { href: "/lenses/table", en: "Table", fr: "Tableau", access: "member" },
  { href: "/lenses/timeline", en: "Timeline", fr: "Chronologie", access: "member" },
  { href: "/lenses/gallery", en: "Gallery", fr: "Galerie", access: "member" },
  { href: "/lenses/feed", en: "Feed", fr: "Fil", access: "member" },
  { href: "/lenses/dashboard", en: "Dashboards", fr: "Tableaux de bord", access: "member" },
  { href: "/lenses/find", en: "Find", fr: "Rechercher", access: "member" },
  { href: "/insight/dashboards", en: "Insight dashboards", fr: "Tableaux de bord d’analyse", access: "member" },
  { href: "/insight/operations", en: "Operations", fr: "Opérations", access: "member" },
  { href: "/insight/graph", en: "Relationship graph", fr: "Graphe des liens", access: "member" },
  { href: "/insight/map", en: "Map", fr: "Carte", access: "member" },
  { href: "/insight/process", en: "How work flows", fr: "Circulation du travail", access: "member" },
  { href: "/insight/what-if", en: "What-if timeline", fr: "Chronologie hypothétique", access: "member" },
  { href: "/pages", en: "Pages", fr: "Pages", access: "member" },
  { href: "/spaces", en: "Spaces", fr: "Espaces", access: "member" },
  { href: "/home/commands", en: "Commands", fr: "Commandes", access: "member" },
  { href: "/apps", en: "Apps", fr: "Applications", access: "member" },
  { href: "/templates-v2", en: "Templates", fr: "Modèles", access: "member" },
  { href: "/builder", en: "Blueprints", fr: "Plans de l’espace", access: "staff" },
  { href: "/collab/layouts", en: "Page layouts", fr: "Mises en page", access: "staff" },
  { href: "/collab/trash", en: "Trash", fr: "Corbeille", access: "member" },
  { href: "/upkeep", en: "Workspace upkeep", fr: "Entretien de l’espace", access: "staff" },
  { href: "/offline", en: "Work offline", fr: "Travailler hors ligne", access: "member" },
  { href: "/m", en: "Phone screens", fr: "Écrans pour téléphone", access: "member" },
  { href: "/api-tokens", en: "API access tokens", fr: "Jetons d’accès à l’API", access: "staff" },
  // Admin-only (owner and admin): Access and sign-in, Roles, Public pages
  // and Workflows. The role matrix in wos-roles.spec.ts and the pages'
  // own redirects cover them; this spec signs in as staff and volunteer.
];

/** The old screens a new one replaces: still reachable, named apart. */
const CLASSIC_SCREENS = [
  { href: "/", en: "Home (classic)", fr: "Accueil (classique)" },
  { href: "/my-work", en: "My Work (classic)", fr: "Mon travail (classique)" },
  { href: "/board", en: "Board (classic)", fr: "Tableau (classique)" },
  { href: "/forms", en: "Forms (classic)", fr: "Formulaires (classique)" },
  { href: "/calendar", en: "Calendar (classic)", fr: "Calendrier (classique)" },
];

const STAFF_ONLY = NEW_SCREENS.filter((s) => s.access !== "member");
const forVolunteers = NEW_SCREENS.filter((s) => s.access === "member");

const text = {
  en: { nav: "Main navigation", search: "Search", goTo: "Go to", classic: "Classic screens", primary: "Primary", open: "Open navigation", drawer: "Navigation" },
  fr: { nav: "Navigation principale", search: "Rechercher", goTo: "Aller à", classic: "Écrans classiques", primary: "Principale", open: "Ouvrir la navigation", drawer: "Navigation" },
};

const sidebar = (page: Page, locale: Locale): Locator =>
  page.getByRole("navigation", { name: text[locale].nav }).first();

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Landed on `href` (or a page under it, "/m" opens "/m/today") with a real heading. */
async function expectLanded(page: Page, href: string) {
  await page.waitForURL(
    (url) => url.pathname === href || (href !== "/" && url.pathname.startsWith(`${href}/`)),
    { timeout: 20_000 },
  );
  await expect(page.getByRole("heading", { level: 1 }).first(), href).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: NOT_FOUND }), href).toHaveCount(0);
}

async function walkSidebar(page: Page, screens: { href: string; en: string; fr: string }[], locale: Locale) {
  for (const screen of screens) {
    const link = sidebar(page, locale).getByRole("link", { name: screen[locale], exact: true });
    await expect(link, `${screen.href} in the sidebar (${locale})`).toBeVisible();
    await link.click();
    await expectLanded(page, screen.href);
    await expect(link, `${screen.href} marked current`).toHaveAttribute("aria-current", "page");
  }
}

async function walkPalette(page: Page, screens: { href: string; en: string; fr: string }[], locale: Locale) {
  for (const screen of screens) {
    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: text[locale].search, exact: true });
    await expect(input).toBeFocused();
    await input.fill(screen[locale]);
    const option = page.getByRole("option", {
      name: new RegExp(`^${escape(screen[locale])}\\s*${escape(text[locale].goTo)}$`),
    });
    await expect(option, `${screen.href} in the palette (${locale})`).toBeVisible();
    await option.click();
    await expectLanded(page, screen.href);
  }
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    localStorage.setItem("qbbe-theme", t);
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
}

async function axeProblems(page: Page, label: string): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${label}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} nodes)\n    ${v.nodes[0]?.html?.slice(0, 160)}`);
}

test.describe.configure({ mode: "serial" });
test.afterAll(() => setSwitches(false));

test("with every switch on, staff reach every new screen from the sidebar and the palette, and the old screens stay reachable", async ({ page }) => {
  test.setTimeout(600_000);
  setSwitches(true);
  await signIn(page, "staff");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const nav = sidebar(page, "en");
  await expect(nav.getByText(text.en.classic, { exact: true })).toBeVisible();
  // Each name once: a replacement and its classic twin never read the same.
  for (const screen of NEW_SCREENS) {
    await expect(nav.getByRole("link", { name: screen.en, exact: true }), screen.href).toHaveCount(1);
  }
  // Setup holds the one staff-level entry; the admin-only rows stay out.
  await expect(nav.getByText("Setup", { exact: true })).toBeVisible();
  for (const name of ["Access and sign-in", "Roles", "Public pages", "Workflows", "Admin"]) {
    await expect(nav.getByRole("link", { name, exact: true }), name).toHaveCount(0);
  }

  await walkSidebar(page, NEW_SCREENS, "en");
  await walkSidebar(page, CLASSIC_SCREENS, "en");
  await walkPalette(page, NEW_SCREENS, "en");
  await walkPalette(page, CLASSIC_SCREENS, "en");

  // The My Work count sits on the new entry, once.
  await page.goto("/");
  const myWork = nav.getByRole("link", { name: /^My Work/ });
  await expect(myWork).toHaveCount(2);
  await expect(nav.getByRole("link", { name: "My Work", exact: true })).toHaveAttribute("href", "/lenses/my-work");
  await expect(nav.getByRole("link", { name: "My Work (classic)", exact: true })).toHaveAttribute("href", "/my-work");
  await expect(nav.getByRole("link", { name: "My Work (classic)", exact: true }).getByText("open items")).toHaveCount(0);
});

test("with every switch on, the mobile tabs follow the sidebar and the drawer lists the new screens", async ({ page }) => {
  test.setTimeout(180_000);
  setSwitches(true);
  await signIn(page, "staff");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const tabs = page.getByRole("navigation", { name: text.en.primary });
  await expect(tabs.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/home");
  await expect(tabs.getByRole("link", { name: /^My Work/ })).toHaveAttribute("href", "/lenses/my-work");
  await expect(tabs.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("href", "/lenses/calendar");
  await tabs.getByRole("link", { name: /^My Work/ }).click();
  await expectLanded(page, "/lenses/my-work");
  await expect(tabs.getByRole("link", { name: /^My Work/ })).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: text.en.open }).click();
  const drawer = page.getByRole("dialog", { name: text.en.drawer });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Saved lenses", exact: true })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "My Work (classic)", exact: true })).toBeVisible();
  await drawer.getByRole("link", { name: "Spaces", exact: true }).click();
  await expectLanded(page, "/spaces");
  await expect(drawer).toHaveCount(0);
});

test("with every switch on, a volunteer reaches the member-level screens and sees no staff-only entry", async ({ page }) => {
  test.setTimeout(600_000);
  setSwitches(true);
  await signIn(page, "volunteer");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const nav = sidebar(page, "en");
  for (const screen of STAFF_ONLY) {
    await expect(nav.getByRole("link", { name: screen.en, exact: true }), screen.href).toHaveCount(0);
  }
  await expect(nav.getByText("Setup", { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Approvals", exact: true })).toHaveCount(0);

  await walkSidebar(page, forVolunteers, "en");
  await walkSidebar(page, CLASSIC_SCREENS, "en");
  await walkPalette(page, forVolunteers, "en");

  // The palette never offers what the sidebar withholds.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: text.en.search, exact: true }).fill("Blueprints");
  await expect(page.getByRole("option", { name: /^Blueprints\s*Go to$/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("with every switch on, every entry has its French name in the sidebar and the palette", async ({ page }) => {
  test.setTimeout(600_000);
  setSwitches(true);
  await signIn(page, "staff");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA", { timeout: 30_000 });

  const nav = sidebar(page, "fr");
  await expect(nav.getByText(text.fr.classic, { exact: true })).toBeVisible();
  for (const label of ["Vues", "Analyse", "Espace de travail"]) {
    await expect(nav.getByText(label, { exact: true }), label).toBeVisible();
  }
  await walkSidebar(page, NEW_SCREENS, "fr");
  await walkSidebar(page, CLASSIC_SCREENS, "fr");
  await walkPalette(page, NEW_SCREENS.slice(0, 8), "fr");
  await walkPalette(page, CLASSIC_SCREENS.slice(0, 2), "fr");
});

test("with every switch on, the sidebar, the palette and the drawer pass axe in both themes", async ({ page }) => {
  test.setTimeout(240_000);
  setSwitches(true);
  await signIn(page, "staff");
  const problems: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home");
    await setTheme(page, theme);
    await page.reload();
    await expect(sidebar(page, "en").getByText(text.en.classic, { exact: true })).toBeVisible();
    problems.push(...(await axeProblems(page, `sidebar ${theme}`)));

    await page.keyboard.press("Control+k");
    const input = page.getByRole("combobox", { name: text.en.search, exact: true });
    await expect(input).toBeFocused();
    await input.fill("Saved");
    await expect(page.getByRole("option", { name: /^Saved lenses\s*Go to$/ })).toBeVisible();
    problems.push(...(await axeProblems(page, `palette ${theme}`)));
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: text.en.open }).click();
    await expect(page.getByRole("dialog", { name: text.en.drawer })).toBeVisible();
    problems.push(...(await axeProblems(page, `drawer ${theme}`)));
    await page.keyboard.press("Escape");
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("with every switch off, nothing new appears in the sidebar, the tabs or the palette", async ({ page }) => {
  test.setTimeout(180_000);
  setSwitches(false);
  await signIn(page, "staff");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const nav = sidebar(page, "en");
  await expect(nav.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
  const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")));
  for (const screen of NEW_SCREENS) expect(hrefs, screen.href).not.toContain(screen.href);
  await expect(nav.getByText(text.en.classic, { exact: true })).toHaveCount(0);
  for (const label of ["Lenses", "Insight", "Workspace", "Setup"]) {
    await expect(nav.getByText(label, { exact: true }), label).toHaveCount(0);
  }
  await expect(nav.getByRole("link", { name: /classic/ })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "My Work", exact: true })).toHaveAttribute("href", "/my-work");
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");

  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: text.en.search, exact: true });
  await expect(input).toBeFocused();
  for (const screen of [NEW_SCREENS[9], NEW_SCREENS[23], NEW_SCREENS[4]]) {
    await input.fill(screen.en);
    await expect(page.getByRole("option", { name: new RegExp(`^${escape(screen.en)}\\s*Go to$`) }), screen.href).toHaveCount(0);
  }
  await input.fill("Board");
  await expect(page.getByRole("option", { name: /^Board\s*Go to$/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = page.getByRole("navigation", { name: text.en.primary });
  await expect(tabs.getByRole("link", { name: /^My Work/ })).toHaveAttribute("href", "/my-work");
  await expect(tabs.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
  await expect(tabs.getByRole("link", { name: "Calendar", exact: true })).toHaveAttribute("href", "/calendar");
});
