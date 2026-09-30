import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M16a (epic #199): autosave, an automatic and a named version,
 * then the trash and a restore, behind the editor switch, in both languages.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("autosave, versions, trash and restore on an object", async ({ page }) => {
  test.setTimeout(180_000);
  // Turned on and never off, so parallel specs never see it flip.
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  const title = `Versioned ${randomUUID().slice(0, 8)}`;
  const taskId = sql(`
    insert into public.task (organization_id, title, created_by)
    select organization_id, '${title}', '${OWNER}'
    from public.organization_membership where user_id = '${OWNER}'
    returning id;
  `);

  await signIn(page, "owner");
  await page.goto(`/collab/versions/${taskId}?type=task`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  // Autosave writes the content and takes the first automatic snapshot.
  await page.getByLabel("Description").fill("Draft plan for the fall launch.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved at / })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select description from public.task where id = '${taskId}'`)).toBe("Draft plan for the fall launch.");
  expect(sql(`select count(*) from public.object_version where object_id = '${taskId}' and kind = 'auto'`)).toBe("1");

  // A named version on demand.
  await page.getByLabel("Version name (optional)").fill("Kick-off");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("Version saved.")).toBeVisible();
  const history = page.getByRole("region", { name: "Version history" });
  await expect(history.getByText("Kick-off")).toBeVisible();
  await expect(history.getByText("Automatic", { exact: true })).toBeVisible();

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on the versions screen").toEqual([]);

  // Trash, then restore.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.waitForURL("**/collab/trash");
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row.getByText("30 days left").or(row.getByText("29 days left"))).toBeVisible();
  const scanTrash = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scanTrash.violations, "axe on the trash").toEqual([]);

  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Corbeille" })).toBeVisible();
  await page.getByRole("button", { name: `Restaurer ${title}` }).click();
  await expect(page.getByText("Restauré.")).toBeVisible();
  await expect(page.getByText("La corbeille est vide.").or(page.getByRole("row", { name: new RegExp(title) }))).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(title) })).toHaveCount(0);
  expect(
    sql(`select count(*) from public.object_trash where object_id = '${taskId}' and restored_at is not null`),
  ).toBe("1");
});
