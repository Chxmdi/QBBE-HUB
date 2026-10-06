import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Spaces (M10a, epic #199), behind the `wos_spaces` switch. The switch is
 * turned on in the database for these tests only and turned back off after,
 * so the rest of the suite still meets the hidden page.
 */

function setSwitch(enabled: boolean) {
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_spaces' and organization_id is null`);
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
}

test.describe("spaces", () => {
  test.afterEach(() => setSwitch(false));

  test("the page stays hidden while the switch is off [switch off]", async ({ page }) => {
    setSwitch(false);
    await signIn(page, "staff");
    await page.goto("/spaces");
    // Streamed pages answer 200 and render the not-found screen.
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toHaveCount(0);
  });

  test("staff see the workspace and their own private space, in both languages", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "staff");
    await page.goto("/spaces");
    await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();

    const workspace = page.getByRole("region", { name: "Workspace", exact: true });
    await expect(workspace.getByRole("heading", { name: "Workspace", level: 3 })).toBeVisible();
    await expect(workspace).toContainText("You can: view, comment, edit content");
    const mine = page.getByRole("region", { name: "Your private space" });
    await expect(mine).toContainText("share");
    // Only administrators create spaces.
    await expect(page.getByRole("heading", { name: "Create a space" })).toHaveCount(0);
    await expectNoSeriousAxeViolations(page);

    const origin = new URL(page.url()).origin;
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Espaces", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Votre espace privé" })).toContainText("Vous pouvez :");
    await expect(page.getByRole("heading", { name: "Espace de travail", level: 3 })).toBeVisible();
    await page.context().clearCookies({ name: "qbbe-locale" });
  });

  test("a volunteer sees only their private space", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "volunteer");
    await page.goto("/spaces");
    await expect(page.getByRole("region", { name: "Workspace", exact: true })).toContainText("No access yet");
    await expect(page.getByRole("region", { name: "Your private space" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Other spaces" })).toContainText("No other spaces yet.");
  });

  test("the owner creates a custom space with the keyboard, and staff cannot see it", async ({ page }) => {
    test.setTimeout(120_000);
    setSwitch(true);
    const name = `Board ${Date.now()}`;
    try {
      await signIn(page, "owner");
      await page.goto("/spaces");
      const form = page.getByRole("region", { name: "Create a space" });
      await form.getByLabel("Name in English").focus();
      await page.keyboard.type(name);
      await page.keyboard.press("Tab");
      await page.keyboard.type(`Conseil ${name}`);
      await page.keyboard.press("Tab");
      await page.keyboard.type("Board papers");
      await page.keyboard.press("Tab");
      await expect(form.getByRole("button", { name: "Create space" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(form.getByRole("status")).toHaveText("Space created.");

      const other = page.getByRole("region", { name: "Other spaces" });
      const card = other.getByRole("listitem").filter({ hasText: name });
      await expect(card).toContainText("Board papers");
      await expect(card).toContainText("manage");
      await expectNoSeriousAxeViolations(page);

      // An empty French name is refused with a message, not a crash.
      await form.getByLabel("Name in English").fill("Only English");
      await form.getByLabel("Name in French").fill(" ");
      await form.getByRole("button", { name: "Create space" }).click();
      await expect(form.getByRole("alert")).toHaveText(
        "Enter a name in both languages (up to 120 characters).",
      );

      await signOut(page);
      await signIn(page, "staff");
      await page.goto("/spaces");
      await expect(page.getByText(name)).toHaveCount(0);
    } finally {
      sql(`delete from space where kind = 'custom' and name_en like 'Board %' and name_en = '${name}'`);
    }
  });
});
