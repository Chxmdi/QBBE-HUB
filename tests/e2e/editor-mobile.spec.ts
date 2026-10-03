import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit E4: mobile editing, behind the `wos_editor` and `wos_mobile`
 * switches (with `wos_pages` for the page itself). At 390 and 320 px the
 * editor fits the screen and gets a touch toolbar (bold, italic, link, list,
 * checklist, heading, undo, redo, move the block, block menu); the slash
 * menu, block menu and formatting toolbar fit and can be closed by touch;
 * desktop widths are unchanged.
 */

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 900 };
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const FORMAT_BUTTONS = ["Bold", "Italic", "Link", "Bulleted list", "Checklist", "Heading", "Undo", "Redo"];
const BLOCK_BUTTONS = ["Move block up", "Move block down", "Open block menu"];

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor', 'wos_mobile') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.use({ hasTouch: true, isMobile: false });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

async function newPage(page: Page, title: string) {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

/**
 * Nothing on the page scrolls sideways: the page is no wider than the
 * screen. When it is, the answer names the elements that stick out.
 */
async function sidewaysOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = window.innerWidth;
    if (document.documentElement.scrollWidth <= width + 1) return [];
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= width + 1) continue;
      // Only elements whose parent fits, so each overflow is named once.
      const parent = el.parentElement?.getBoundingClientRect();
      if (parent && parent.right > width + 1) continue;
      out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(box.right)}`);
    }
    return out.length ? out : [`page is ${document.documentElement.scrollWidth}px wide`];
  });
}

/**
 * The element lies wholly inside the screen and, unless it is a modal dialog
 * (drawn above the whole page), above the workspace's fixed bottom
 * navigation, so all of it can be read and tapped.
 */
async function onScreen(page: Page, locator: Locator, { modal = false } = {}) {
  // Retried: a resize settles over a frame or two.
  await expect.poll(() => offScreenEdges(page, locator, modal)).toEqual([]);
}

async function offScreenEdges(page: Page, locator: Locator, modal: boolean): Promise<string[]> {
  const box = await locator.boundingBox();
  if (!box) return ["no box"];
  const { left, top, right, bottom } = await page.evaluate((modal) => {
    const nav = [...document.querySelectorAll("nav")].find((el) => getComputedStyle(el).position === "fixed" && el.getBoundingClientRect().bottom >= window.innerHeight - 1);
    const navTop = !modal && nav && nav.getClientRects().length > 0 ? nav.getBoundingClientRect().top : window.innerHeight;
    return { left: 0, top: 0, right: window.innerWidth, bottom: Math.min(window.innerHeight, navTop) };
  }, modal);
  const problems: string[] = [];
  if (box.x < left - 0.5) problems.push(`left edge ${box.x}`);
  if (box.y < top - 0.5) problems.push(`top edge ${box.y}`);
  if (box.x + box.width > right + 0.5) problems.push(`right edge ${box.x + box.width} > ${right}`);
  if (box.y + box.height > bottom + 0.5) problems.push(`bottom edge ${box.y + box.height} > ${bottom} (screen or bottom navigation)`);
  return problems;
}

async function blockTexts(editor: Locator): Promise<string[]> {
  return editor.locator("[data-content-type='paragraph']").evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? "").filter(Boolean));
}

async function seriousAxe(page: Page, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(WCAG);
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

test("at 390 and 320 px the editor fits and its touch toolbar formats text [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(PHONE);
  await signIn(page, "staff");
  const editor = await newPage(page, `Phone editing ${Date.now()}`);
  await editor.tap();

  const toolbar = page.getByRole("toolbar", { name: "Touch toolbar" });
  await expect(toolbar).toBeVisible();
  for (const name of [...FORMAT_BUTTONS, ...BLOCK_BUTTONS]) await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  const tap = (name: string) => toolbar.getByRole("button", { name, exact: true }).tap();

  // Bold and italic, toggled on and off, keep the caret in the text.
  await tap("Bold");
  await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.type("Strong");
  await tap("Bold");
  await tap("Italic");
  await page.keyboard.type("Slanted");
  await tap("Italic");
  await page.keyboard.type(" plain");
  await expect(editor.locator("strong", { hasText: "Strong" })).toBeVisible();
  await expect(editor.locator("em", { hasText: "Slanted" })).toBeVisible();
  await expect(editor.locator("strong", { hasText: "plain" })).toHaveCount(0);

  // Heading, list and checklist turn the block into each and back.
  await tap("Heading");
  await expect(editor.locator("h2", { hasText: "Strong" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Heading", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tap("Bulleted list");
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: "Strong" })).toBeVisible();
  await tap("Checklist");
  await expect(editor.locator("[data-content-type='checkListItem']", { hasText: "Strong" })).toBeVisible();
  await tap("Checklist");
  await expect(editor.locator("[data-content-type='paragraph']", { hasText: "Strong" })).toBeVisible();

  // A link: an unsafe address is refused, a bare domain becomes https.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await tap("Link");
  const dialog = page.getByRole("dialog", { name: "Add a link" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Link address").fill("javascript:alert(1)");
  await dialog.getByRole("button", { name: "Add link" }).tap();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a web address (https://…) or an email address (mailto:…).");
  await dialog.getByLabel("Link address").fill("example.org/guide");
  await dialog.getByLabel("Link text (optional)").fill("The guide");
  await dialog.getByRole("button", { name: "Add link" }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator("a[href='https://example.org/guide']", { hasText: "The guide" })).toBeVisible();
  await expect(editor.locator("a[href^='javascript']")).toHaveCount(0);

  // Undo takes the link away, redo puts it back.
  await tap("Undo");
  await expect(editor.locator("a[href='https://example.org/guide']")).toHaveCount(0);
  await tap("Redo");
  await expect(editor.locator("a[href='https://example.org/guide']")).toBeVisible();

  // With the caret inside that link, Link edits it rather than adding another.
  await editor.locator("a", { hasText: "The guide" }).tap();
  await tap("Link");
  await expect(dialog.getByLabel("Link address")).toHaveValue("https://example.org/guide");
  await dialog.getByLabel("Link address").fill("example.org/handbook");
  await dialog.getByRole("button", { name: "Add link" }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(editor.locator("a[href='https://example.org/handbook']")).toHaveText("The guide");
  await expect(editor.locator("a")).toHaveCount(1);

  expect(await sidewaysOverflow(page), "390 px: no sideways scroll").toEqual([]);
  await page.setViewportSize(SMALL);
  await expect(toolbar).toBeVisible();
  expect(await sidewaysOverflow(page), "320 px: no sideways scroll").toEqual([]);
  // A narrower window reflows the page above the editor; a phone keeps the
  // line being typed in view, and the toolbar sticks on screen with it.
  await editor.locator("a", { hasText: "The guide" }).scrollIntoViewIfNeeded();
  await onScreen(page, toolbar);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("each block moves up and down and opens the block menu by touch [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(SMALL);
  await signIn(page, "staff");
  const editor = await newPage(page, `Phone blocks ${Date.now()}`);
  await editor.tap();
  for (const text of ["Alpha", "Bravo"]) {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("Charlie");
  await expect.poll(() => blockTexts(editor)).toEqual(["Alpha", "Bravo", "Charlie"]);

  const toolbar = page.getByRole("toolbar", { name: "Touch toolbar" });
  for (const name of [...FORMAT_BUTTONS, ...BLOCK_BUTTONS]) {
    const box = await toolbar.getByRole("button", { name, exact: true }).boundingBox();
    expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(24);
    expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(24);
  }

  await toolbar.getByRole("button", { name: "Move block up", exact: true }).tap();
  await expect.poll(() => blockTexts(editor)).toEqual(["Alpha", "Charlie", "Bravo"]);
  await toolbar.getByRole("button", { name: "Move block up", exact: true }).tap();
  await expect.poll(() => blockTexts(editor)).toEqual(["Charlie", "Alpha", "Bravo"]);
  await expect(page.locator("#qbbe-editor-live")).toHaveText("Moved above “Alpha”.");
  await toolbar.getByRole("button", { name: "Move block up", exact: true }).tap();
  await expect(page.locator("#qbbe-editor-live")).toHaveText("Already at the top.");
  await toolbar.getByRole("button", { name: "Move block down", exact: true }).tap();
  await expect.poll(() => blockTexts(editor)).toEqual(["Alpha", "Charlie", "Bravo"]);

  // The block menu opens for the block holding the caret, fits, and acts.
  await toolbar.getByRole("button", { name: "Open block menu", exact: true }).tap();
  const menu = page.getByRole("dialog", { name: "Block menu" });
  await expect(menu).toBeVisible();
  await onScreen(page, menu, { modal: true });
  expect(await sidewaysOverflow(page)).toEqual([]);
  await menu.getByRole("button", { name: "Move block down", exact: true }).tap();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => blockTexts(editor)).toEqual(["Alpha", "Bravo", "Charlie"]);

  // And it closes by touch without doing anything.
  await editor.locator("p", { hasText: "Alpha" }).tap();
  await toolbar.getByRole("button", { name: "Open block menu", exact: true }).tap();
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Close dialog" }).tap();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => blockTexts(editor)).toEqual(["Alpha", "Bravo", "Charlie"]);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("the slash menu and formatting toolbar fit at 320 px and close by touch [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(SMALL);
  await signIn(page, "staff");
  const editor = await newPage(page, `Phone menus ${Date.now()}`);
  await editor.tap();
  const toolbar = page.getByRole("toolbar", { name: "Touch toolbar" });
  const closeMenu = toolbar.getByRole("button", { name: "Close menu", exact: true });
  await expect(closeMenu).toHaveCount(0);

  // The slash menu.
  await page.keyboard.type("/");
  const slash = page.locator(".bn-suggestion-menu");
  await expect(slash).toBeVisible();
  await onScreen(page, slash);
  expect(await sidewaysOverflow(page)).toEqual([]);
  await closeMenu.tap();
  await expect(slash).toHaveCount(0);
  await expect(closeMenu).toHaveCount(0);

  // The formatting toolbar, on a selected word.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("Select these words please");
  await page.keyboard.press("Shift+Home");
  const formatting = page.locator(".bn-formatting-toolbar");
  await expect(formatting).toBeVisible();
  await onScreen(page, formatting);
  expect(await sidewaysOverflow(page)).toEqual([]);
  await closeMenu.tap();
  await expect(formatting).toHaveCount(0);
  await expect(editor).toContainText("Select these words please");
});

test("the touch toolbar speaks Quebec French, works from the keyboard and passes axe in both themes [switches on]", async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(SMALL);
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Nouvelle page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const editor = page.getByRole("textbox", { name: "Contenu du document" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Bonjour");

  const toolbar = page.getByRole("toolbar", { name: "Barre d’outils tactile" });
  await expect(toolbar).toBeVisible();
  for (const name of ["Gras", "Italique", "Lien", "Liste à puces", "Liste à cocher", "Titre", "Annuler", "Rétablir", "Monter le bloc", "Descendre le bloc", "Ouvrir le menu du bloc"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  }

  // Keyboard only: Alt+F10 into the toolbar, arrows along it, Enter presses,
  // Escape goes back to the text.
  await page.keyboard.press("Alt+F10");
  await expect(toolbar.getByRole("button", { name: "Gras", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(toolbar.getByRole("button", { name: "Ouvrir le menu du bloc", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(toolbar.getByRole("button", { name: "Titre", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor.locator("h2", { hasText: "Bonjour" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toBeFocused();
  await page.keyboard.type(" à tous");
  await expect(editor.locator("h2")).toHaveText("Bonjour à tous");

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await editor.locator("h2").click();
    await expect(toolbar).toBeVisible();
    await toolbar.getByRole("button", { name: "Gras", exact: true }).tap();
    expect(await seriousAxe(page), `${theme}: toolbar open`).toEqual([]);
    await toolbar.getByRole("button", { name: "Gras", exact: true }).tap();
    await toolbar.getByRole("button", { name: "Lien", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Ajouter un lien" });
    await expect(dialog).toBeVisible();
    await onScreen(page, dialog, { modal: true });
    expect(await seriousAxe(page), `${theme}: link dialog open`).toEqual([]);
    await dialog.getByRole("button", { name: "Annuler", exact: true }).tap();
    await expect(dialog).toHaveCount(0);
  }
  await page.evaluate(() => {
    localStorage.setItem("qbbe-theme", "light");
    document.documentElement.classList.remove("dark");
  });
});

test("nothing changes at desktop width [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize(DESKTOP);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/editor/mobile")) asked.push(request.url());
  });
  await signIn(page, "staff");
  const editor = await newPage(page, `Desktop editing ${Date.now()}`);
  await editor.click();
  await page.keyboard.type("Desktop text");
  await expect(editor).toContainText("Desktop text");

  await expect(page.getByRole("toolbar", { name: "Touch toolbar" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-qbbe-mobile-editing"))).toBe(false);
  // The editor keeps BlockNote's own side padding for the hover handle, and
  // the handle still appears on hover.
  const padding = await page.locator(".qbbe-editor .bn-editor").evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(padding).not.toBe("4px");
  await editor.locator("p", { hasText: "Desktop text" }).hover();
  await expect(page.locator(".qbbe-editor .bn-side-menu")).toBeVisible();
  // The slash menu keeps its desktop size.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const slash = page.locator(".bn-suggestion-menu");
  await expect(slash).toBeVisible();
  expect(await slash.evaluate((el) => getComputedStyle(el).maxWidth)).toBe("none");
  await page.keyboard.press("Escape");
  // The phone switch is not even asked about at this width.
  expect(asked).toEqual([]);

  // Narrowing the same window turns mobile editing on; widening turns it off.
  await page.setViewportSize(PHONE);
  await editor.locator("p", { hasText: "Desktop text" }).click();
  await expect(page.getByRole("toolbar", { name: "Touch toolbar" })).toBeVisible();
  await page.setViewportSize(DESKTOP);
  await expect(page.getByRole("toolbar", { name: "Touch toolbar" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-qbbe-mobile-editing"))).toBe(false);
});

test("with the phone switch off, the editor at 390 px has no touch toolbar [switch off]", async ({ page }) => {
  test.setTimeout(180_000);
  sql("update public.feature_flag set enabled = false where key = 'wos_mobile' and organization_id is null;");
  try {
    await page.setViewportSize(PHONE);
    await signIn(page, "staff");
    const answer = page.waitForResponse((response) => response.url().includes("/api/editor/mobile"));
    const editor = await newPage(page, `No phone editing ${Date.now()}`);
    await editor.tap();
    expect(await (await answer).json()).toEqual({ enabled: false });
    await page.keyboard.type("Still editable");
    await expect(editor).toContainText("Still editable");
    await expect(page.getByRole("toolbar", { name: "Touch toolbar" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-qbbe-mobile-editing"))).toBe(false);
  } finally {
    switches(true);
  }
});

// The touch toolbar used to rise whenever focus went anywhere in the editor,
// the undo bar included: pressing Undo, Redo or Keyboard shortcuts near the
// bottom of a phone screen raised it over the button, and the tap ended on the
// toolbar and did nothing.
test("at 320 px the undo bar's buttons work by touch, with the touch toolbar open or not [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(SMALL);
  await signIn(page, "staff");
  await newPage(page, `Undo bar ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const bar = page.getByRole("group", { name: "Undo history" });

  await editor.click();
  await page.keyboard.type("Typed words");
  await expect(page.getByRole("toolbar", { name: "Touch toolbar" })).toBeVisible();
  await bar.scrollIntoViewIfNeeded();
  await bar.getByRole("button", { name: /^Undo/ }).click();
  await expect(editor).not.toContainText("Typed words");

  const shortcuts = page.getByRole("button", { name: "Keyboard shortcuts" });
  await shortcuts.scrollIntoViewIfNeeded();
  await shortcuts.click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
});
