import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Apps (V2-3), behind the `wos_objects` switch: an owner creates an app, gives
 * it a board and an action, lets Staff open it and publishes it; staff open it
 * from the launcher with its own menu; a volunteer without a grant never sees
 * it; the launcher reads in French.
 */

const SLUG = `e2e-desk-${Date.now().toString(36)}`;

async function noSeriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
}

test.beforeAll(() => {
  sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
});

test.afterAll(() => {
  sql("delete from public.workspace_app where slug like 'e2e-desk-%';");
  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
});

test("owner builds and publishes an app that staff can open", async ({ page }) => {
  test.slow();
  await signIn(page, "owner");
  await page.goto("/apps");
  await expect(page.getByRole("heading", { name: "Apps", level: 1 })).toBeVisible();
  await page.getByLabel("Name (English)").fill("Coordination desk");
  await page.getByLabel("Name (French)").fill("Bureau de coordination");
  await page.getByLabel("Web address").fill(SLUG);
  await page.getByRole("button", { name: "Create app" }).click();
  await page.waitForURL(/\/apps\/manage\/[0-9a-f-]{36}$/);
  await noSeriousViolations(page, "manage");

  // The starter screens are a task table and an overview; make the table a board.
  await page.getByLabel("View").first().selectOption("board");
  await page.getByRole("button", { name: "Add action" }).click();
  await page.getByLabel("Label (English)").fill("Assign to me");
  await page.getByLabel("Label (French)").fill("M’assigner");
  await page.getByRole("checkbox", { name: "Staff: Open" }).check();
  await page.getByRole("checkbox", { name: "Staff: Run actions" }).check();
  await page.getByRole("button", { name: "Save app" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published. People with permission can open it.")).toBeVisible();
  expect(sql(`select count(*) from public.workspace_app_grant g join public.workspace_app a on a.id = g.app_id where a.slug = '${SLUG}' and g.org_role = 'staff';`)).toBe("1");
  await signOut(page);

  await signIn(page, "staff");
  await page.goto("/apps");
  await page.getByRole("link", { name: "Open Coordination desk" }).click();
  await page.waitForURL(new RegExp(`/apps/${SLUG}/tasks$`));
  const menu = page.getByRole("navigation", { name: "Coordination desk menu" });
  await expect(menu.getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Manage this app" })).toHaveCount(0);
  await noSeriousViolations(page, "app board");

  await page.getByRole("button", { name: "Assign to me" }).click();
  await expect(page.getByText("This action becomes available when the action registry is switched on.")).toBeVisible();

  await menu.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tile-in_progress")).toHaveText(/^\d+\+?$/);
  await noSeriousViolations(page, "dashboard");
  await signOut(page);

  await signIn(page, "volunteer");
  await page.goto("/apps");
  await expect(page.getByText("No apps are shared with you yet.")).toBeVisible();
  await page.goto(`/apps/${SLUG}/tasks`);
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
});

test("the launcher reads in French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/apps");
  await expect(page.getByRole("heading", { name: "Applications", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer l’application" })).toBeVisible();
  await noSeriousViolations(page, "French launcher");
});

test("apps are hidden while the switch is off", async ({ page }) => {
  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
  try {
    await signIn(page, "owner");
    await page.goto("/apps");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  }
});
