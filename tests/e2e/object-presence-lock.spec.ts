import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-17 part 1 (epic #199): two people on one object see each
 * other and where the other's cursor is; locking makes it read-only for
 * everyone until it is unlocked.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("presence, cursors and page lock between two people", async ({ browser, page }) => {
  test.setTimeout(240_000);
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  const title = `Live ${randomUUID().slice(0, 8)}`;
  const taskId = sql(`
    insert into public.task (organization_id, title, description, created_by)
    select organization_id, '${title}', 'Budget for the spring gala.', '${OWNER}'
    from public.organization_membership where user_id = '${OWNER}'
    returning id;
  `);
  const path = `/collab/live/${taskId}?type=task`;

  await signIn(page, "owner");
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "admin");
  await admin.goto(path);

  // Each sees the other, as an editor.
  await expect(page.getByRole("region", { name: "People here now" }).getByRole("listitem").filter({ hasText: "QA Admin (editing)" })).toHaveCount(1, { timeout: 30_000 });
  await expect(admin.getByRole("region", { name: "People here now" }).getByRole("listitem").filter({ hasText: "QA Owner (editing)" })).toHaveCount(1, { timeout: 30_000 });

  // The owner's selection shows up for the admin.
  const description = page.getByLabel("Description");
  await description.focus();
  await description.press("Control+Home");
  for (let step = 0; step < 6; step++) await description.press("Shift+ArrowRight");
  await expect(admin.getByText("QA Owner has 6 characters selected in Description")).toBeVisible({ timeout: 30_000 });

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on the live screen").toEqual([]);

  // Lock with a reason: read-only for everyone.
  await page.getByLabel("Why lock it? (optional)").fill("Approved by the board");
  await page.getByRole("button", { name: "Lock page" }).click();
  await expect(page.getByText("Locked by QA Owner: Approved by the board")).toBeVisible();
  await expect(page.getByLabel("Description")).toBeDisabled();
  await admin.reload();
  await expect(admin.getByText("Locked by QA Owner: Approved by the board")).toBeVisible();
  await expect(admin.getByLabel("Description")).toBeDisabled();

  const scanLocked = await new AxeBuilder({ page: admin }).withTags(WCAG).analyze();
  expect(scanLocked.violations, "axe on the locked live screen").toEqual([]);

  // Unlock (the admin manages it too), in French.
  await admin.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: admin.url() }]);
  await admin.reload();
  await admin.getByRole("button", { name: "Déverrouiller la page" }).click();
  await expect(admin.getByRole("button", { name: "Verrouiller la page" })).toBeVisible();
  await expect(admin.getByLabel("Description")).toBeEnabled();
  expect(sql(`select count(*) from public.object_lock where object_id = '${taskId}'`)).toBe("0");

  await adminContext.close();
});
