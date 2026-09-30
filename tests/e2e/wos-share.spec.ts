import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Share menu (M10f, epic #199), behind the `wos_spaces` switch, turned on in
 * the database for these tests only.
 */

function setSwitch(enabled: boolean) {
  sql(`update feature_flag set enabled = ${enabled} where key = 'wos_spaces' and organization_id is null`);
}

test.describe("share menu", () => {
  test.afterEach(() => setSwitch(false));

  test("the owner shares a space with the keyboard; the person gets exactly that access", async ({ page }) => {
    test.setTimeout(150_000);
    setSwitch(true);
    const name = `Committee ${Date.now()}`;
    const orgId = sql(
      `select organization_id::text from organization_membership m join user_profile p on p.id = m.user_id where p.email = 'qa-owner@example.com'`,
    );
    const spaceId = sql(
      `insert into space (organization_id, kind, name_en, name_fr) values ('${orgId}', 'custom', '${name}', 'Comité ${name}') returning id`,
    );
    try {
      await signIn(page, "owner");
      await page.goto(`/spaces/${spaceId}`);
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();

      const add = page.getByRole("form", { name: "Give access" });
      await expect(add.getByRole("radio", { name: "Person" })).toBeChecked();
      await add.getByLabel("Who", { exact: true }).focus();
      await add.getByLabel("Who", { exact: true }).selectOption({ label: "QA Staff" });
      await add.getByLabel("Access", { exact: true }).selectOption({ label: "Can edit" });
      await add.getByRole("button", { name: "Share" }).focus();
      await page.keyboard.press("Enter");
      await expect(add.getByRole("status")).toHaveText("Access given.");

      const entry = page.getByRole("listitem").filter({ hasText: "QA Staff" });
      await expect(entry).toContainText("Can edit");
      await expect(entry).toContainText("Given here");

      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

      // Change it to view only, by keyboard.
      await entry.getByLabel("Access for QA Staff").selectOption({ label: "Can view" });
      await entry.getByRole("button", { name: "Save" }).click();
      await expect(entry.getByRole("status")).toHaveText("Access changed.");

      // Staff now see the space, but cannot change who has access.
      await signOut(page);
      await signIn(page, "staff");
      await page.goto(`/spaces/${spaceId}`);
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(page.getByText("You can see who has access, but you can’t change it here.")).toBeVisible();
      await expect(page.getByRole("form", { name: "Give access" })).toHaveCount(0);

      // A volunteer was never given access: the page does not exist for them.
      await signOut(page);
      await signIn(page, "volunteer");
      await page.goto(`/spaces/${spaceId}`);
      await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

      // Removal takes effect at once.
      await signOut(page);
      await signIn(page, "owner");
      await page.goto(`/spaces/${spaceId}`);
      await page.getByRole("button", { name: "Remove access for QA Staff" }).click();
      await expect(page.getByRole("listitem").filter({ hasText: "QA Staff" })).toHaveCount(0);
    } finally {
      sql(`delete from space where id = '${spaceId}'`);
    }
  });

  test("the workspace explains where default access comes from, in French too", async ({ page }) => {
    setSwitch(true);
    const workspaceId = sql(
      `select s.id from space s join organization_membership m on m.organization_id = s.organization_id join user_profile p on p.id = m.user_id where p.email = 'qa-admin@example.com' and s.kind = 'workspace'`,
    );
    await signIn(page, "admin");
    await page.goto(`/spaces/${workspaceId}`);
    await expect(page.getByRole("listitem").filter({ hasText: "Staff" })).toContainText("Everyone with this role, by default");

    const origin = new URL(page.url()).origin;
    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Qui y a accès" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Personnel" })).toContainText("par défaut");
    await page.context().clearCookies({ name: "qbbe-locale" });
  });
});
