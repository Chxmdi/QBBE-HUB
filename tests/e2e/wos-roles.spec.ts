import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Custom roles (M10d, epic #199), behind the `wos_spaces` switch, turned on
 * in the database for these tests only.
 */

function setSwitch(enabled: boolean) {
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_spaces' and organization_id is null`);
}

test.describe("custom roles", () => {
  test.afterEach(() => setSwitch(false));

  test("staff are sent away from the roles screen", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "staff");
    await page.goto("/spaces/roles");
    await expect(page).toHaveURL(/\/\?denied=1$/);
  });

  test("the owner creates, edits and deletes a role with the keyboard", async ({ page }) => {
    test.setTimeout(120_000);
    setSwitch(true);
    const name = `Reviewers ${Date.now()}`;
    try {
      await signIn(page, "owner");
      await page.goto("/spaces/roles");
      await expect(page.getByRole("heading", { name: "Roles", level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: "Built-in roles" })).toContainText("Can edit");

      const create = page.getByRole("region", { name: "Create a role" });
      await create.getByLabel("Name in English").focus();
      await page.keyboard.type(name);
      await page.keyboard.press("Tab");
      await page.keyboard.type(`Réviseurs ${name}`);
      const group = create.getByRole("group", { name: "Capabilities" });
      await expect(group.getByRole("checkbox", { name: "view" })).toBeChecked();
      await group.getByRole("checkbox", { name: "comment" }).focus();
      await page.keyboard.press("Space");
      await group.getByRole("checkbox", { name: "share" }).focus();
      await page.keyboard.press("Space");
      await create.getByRole("button", { name: "Create role" }).focus();
      await page.keyboard.press("Enter");
      await expect(create.getByRole("status")).toHaveText("Role created.");

      const card = page.getByRole("region", { name: "Your organization's roles" }).getByRole("listitem").filter({ hasText: name });
      await expect(card).toContainText("view, comment, share");
      await expect(card).toContainText("Not used yet");

      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

      // Edit: open the disclosure with the keyboard, drop "share".
      const summary = card.locator("summary");
      await summary.focus();
      await page.keyboard.press("Enter");
      await card.getByRole("checkbox", { name: "share" }).uncheck();
      await card.getByRole("button", { name: "Save role" }).click();
      await expect(card.getByRole("status")).toHaveText("Role saved.");
      await expect(page.getByRole("region", { name: "Your organization's roles" }).getByRole("listitem").filter({ hasText: name }))
        .toContainText("view, comment");

      await page.getByRole("button", { name: `Delete ${name}` }).click();
      await expect(page.getByRole("region", { name: "Your organization's roles" }).getByText(name)).toHaveCount(0);
    } finally {
      sql(`delete from access_role where organization_id is not null and name_en = '${name}'`);
    }
  });

  test("the roles screen reads in French", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "admin");
    const origin = new URL(page.url()).origin;
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
    await page.goto("/spaces/roles");
    await expect(page.getByRole("heading", { name: "Rôles", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Rôles intégrés" })).toContainText("Peut modifier");
    await expect(page.getByRole("group", { name: "Capacités" })).toBeVisible();
    await page.context().clearCookies({ name: "qbbe-locale" });
  });
});
