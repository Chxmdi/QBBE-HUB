import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS pages (M4a, epic #199): create, nest, rename, icon, cover,
 * favourite, recent, reorder from the keyboard, move, duplicate, trash and
 * restore, behind the `wos_pages` switch. The suite runs on one worker, so
 * turning the switch on here cannot leak into a spec running alongside.
 */

const setSwitch = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key = 'wos_pages' and organization_id is null;`);

const NOT_FOUND = "Not found — or not yours to see";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => setSwitch(true));
test.afterAll(() => setSwitch(false));

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id}: ${v.help} — ${v.nodes[0]?.html?.slice(0, 160)}`);
  expect(serious).toEqual([]);
}

async function chooseAction(page: Page, pageTitle: string, action: string) {
  const main = page.locator("article");
  await main.getByRole("button", { name: `Actions for ${pageTitle}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("staff build a page tree and manage it from the keyboard", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff");
  const stamp = Date.now();
  const parentTitle = `Handbook ${stamp}`;
  const childTitle = `Onboarding ${stamp}`;
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  const workspace = sidebar.getByRole("region", { name: "Workspace" });

  await page.goto("/pages");
  await expect(page.getByRole("heading", { level: 1, name: "Pages" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // Create and title a workspace page.
  await sidebar.getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const title = page.getByRole("textbox", { name: "Page title" });
  await title.fill(parentTitle);
  await title.press("Enter");
  await expect(workspace.getByRole("link", { name: parentTitle })).toBeVisible({ timeout: 30_000 });
  const parentUrl = page.url();

  // A page inside it, reached by the row's own button.
  await workspace.getByRole("button", { name: `Add a page inside ${parentTitle}` }).click();
  await expect(page).not.toHaveURL(parentUrl, { timeout: 30_000 });
  const childTitleBox = page.getByRole("textbox", { name: "Page title" });
  await childTitleBox.fill(childTitle);
  await childTitleBox.press("Tab");
  await expect(page.getByRole("navigation", { name: "Page location" }).getByRole("link", { name: parentTitle })).toBeVisible({
    timeout: 30_000,
  });
  await expect(workspace.getByRole("link", { name: childTitle })).toBeVisible();

  // Collapse and expand the branch with the disclosure button.
  const toggle = workspace.getByRole("button", { name: `Collapse ${parentTitle}` });
  await toggle.click();
  await expect(workspace.getByRole("link", { name: childTitle })).toHaveCount(0);
  await workspace.getByRole("button", { name: `Expand ${parentTitle}` }).click();
  await expect(workspace.getByRole("link", { name: childTitle })).toBeVisible();

  // Icon and cover through their dialogs.
  await chooseAction(page, childTitle, "Change icon");
  const iconDialog = page.getByRole("dialog", { name: "Choose an icon" });
  await iconDialog.getByLabel("Icon (an emoji or up to 32 characters)").fill("🧭");
  await iconDialog.getByRole("button", { name: "Save" }).click();
  await expect(iconDialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("article").getByText("🧭").first()).toBeVisible();

  await chooseAction(page, childTitle, "Change cover");
  const coverDialog = page.getByRole("dialog", { name: "Choose a cover" });
  await coverDialog.getByRole("button", { name: "Green" }).click();
  await coverDialog.getByRole("button", { name: "Save" }).click();
  await expect(coverDialog).toHaveCount(0, { timeout: 30_000 });

  // Favourite it: it appears under Favourites.
  await chooseAction(page, childTitle, "Add to favourites");
  const favourites = sidebar.getByRole("region", { name: "Favourites" });
  await expect(favourites.getByRole("link", { name: childTitle })).toBeVisible({ timeout: 30_000 });

  // The parent shows in Recent after visiting it.
  await page.goto(parentUrl);
  await page.reload();
  await expect(sidebar.getByRole("region", { name: "Recent" }).getByRole("link", { name: childTitle })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pages inside" }).getByRole("link", { name: childTitle })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  // Keyboard only: open the parent's menu and duplicate it.
  const menuButton = page.locator("article").getByRole("button", { name: `Actions for ${parentTitle}` });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  for (let i = 0; i < 20; i += 1) {
    if ((await page.evaluate(() => document.activeElement?.textContent ?? "")).includes("Duplicate")) break;
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(`${parentTitle} (copy)`, { timeout: 30_000 });

  // Move the copy inside the original with the Move dialog.
  await chooseAction(page, `${parentTitle} (copy)`, "Move to…");
  const moveDialog = page.getByRole("dialog", { name: "Move page" });
  const target = moveDialog.getByLabel("Move inside");
  const optionValue = await target.locator("option", { hasText: parentTitle }).first().getAttribute("value");
  await target.selectOption(optionValue!);
  await moveDialog.getByRole("button", { name: "Save" }).click();
  await expect(moveDialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Page location" }).getByRole("link", { name: parentTitle })).toBeVisible({
    timeout: 30_000,
  });

  // Trash the copy, then restore it from the page.
  await chooseAction(page, `${parentTitle} (copy)`, "Move to trash");
  await expect(page.getByText("This page is in the trash.")).toBeVisible({ timeout: 30_000 });
  await expect(workspace.getByRole("link", { name: `${parentTitle} (copy)` })).toHaveCount(0);
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("This page is in the trash.")).toHaveCount(0, { timeout: 30_000 });
  await expect(workspace.getByRole("link", { name: `${parentTitle} (copy)` })).toBeVisible();
});

test("volunteers keep private pages and cannot see or create shared ones", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "volunteer");
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await page.goto("/pages");
  await expect(sidebar.getByRole("button", { name: "New page", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("region", { name: "Workspace" }).getByRole("link")).toHaveCount(0);

  await sidebar.getByRole("button", { name: "New private page" }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const privateTitle = `My notes ${Date.now()}`;
  const title = page.getByRole("textbox", { name: "Page title" });
  await title.fill(privateTitle);
  await title.press("Enter");
  await expect(sidebar.getByRole("region", { name: "Private" }).getByRole("link", { name: privateTitle })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("article").getByText("Private", { exact: true })).toBeVisible();
});

test("French labels on the pages screen", async ({ page, context }) => {
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto("/pages");
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar.getByRole("region", { name: "Favoris" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Nouvelle page", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Privé" })).toBeVisible();
});

test("the pages screens are hidden while the switch is off", async ({ page }) => {
  setSwitch(false);
  await signIn(page, "staff");
  try {
    // The workspace streams, so the status is already sent; check what renders.
    await page.goto("/pages");
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pages" })).toHaveCount(0);
  } finally {
    setSwitch(true);
  }
});
