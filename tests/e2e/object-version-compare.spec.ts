import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M16b (epic #199): compare a named version with the current
 * state side by side, then restore one property and one block.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("compare two versions and restore one property and one block", async ({ page }) => {
  test.setTimeout(180_000);
  sql("update public.feature_flag set enabled = true where key = 'wos_editor';");
  const title = `Gala ${randomUUID().slice(0, 8)}`;
  const taskId = sql(`
    insert into public.task (organization_id, title, description, priority, created_by)
    select organization_id, '${title}', 'Plan the gala dinner.', 'medium', '${OWNER}'
    from public.organization_membership where user_id = '${OWNER}'
    returning id;
  `);

  await signIn(page, "owner");
  await page.goto(`/collab/versions/${taskId}?type=task`);
  await page.getByLabel("Version name (optional)").fill("Original");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("Version saved.")).toBeVisible();

  // Change the content through autosave and a property behind the scenes.
  await page.getByLabel("Description").fill("Plan the spring gala dinner with sponsors.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved at / })).toBeVisible({ timeout: 30_000 });
  sql(`update public.task set priority = 'high' where id = '${taskId}'`);

  await page.reload();
  await page.getByRole("link", { name: /^Compare with current \(Original,/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  await expect(page.getByText("3 differences").or(page.getByText("2 differences"))).toBeVisible();
  const content = page.getByRole("table", { name: "Content" });
  await expect(content.locator("ins", { hasText: "spring" })).toBeVisible();
  const properties = page.getByRole("table", { name: "Properties" });
  const priority = properties.getByRole("row", { name: /Priority/ });
  await expect(priority.getByRole("cell", { name: "medium" })).toBeVisible();
  await expect(priority.getByRole("cell", { name: "high" })).toBeVisible();

  const scan = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scan.violations, "axe on the compare screen").toEqual([]);

  // One property.
  await priority.getByRole("button", { name: "Restore Priority" }).click();
  await expect(page.getByText("Restored. The previous state was saved as a version.")).toBeVisible();
  await expect.poll(() => sql(`select priority from public.task where id = '${taskId}'`)).toBe("medium");
  expect(sql(`select description from public.task where id = '${taskId}'`)).toBe(
    "Plan the spring gala dinner with sponsors.",
  );

  // One block.
  await content.getByRole("button", { name: "Restore this block" }).click();
  await expect.poll(() => sql(`select description from public.task where id = '${taskId}'`)).toBe("Plan the gala dinner.");
  expect(
    sql(`select count(*) from public.object_version where object_id = '${taskId}' and kind = 'restore'`),
  ).toBe("2");

  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Comparer des versions" })).toBeVisible();
  const scanFr = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(scanFr.violations, "axe on the compare screen in French").toEqual([]);
});
