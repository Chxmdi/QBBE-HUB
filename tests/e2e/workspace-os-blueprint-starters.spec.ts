import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Starter blueprints (V2-2): an owner copies the Grant starter into a draft,
 * approves it and builds it as one change set; staff only see the list; the
 * starters read in French. Behind the `wos_objects` switch, on for this file.
 */

/** Removes this file's blueprints, builds first (a built blueprint cannot be deleted). */
function cleanUp() {
  sql(`
    delete from public.blueprint_build where blueprint_id in (select id from public.blueprint where key like 'grant%');
    update public.blueprint set status = 'draft', approved_hash = null, approved_by = null, approved_at = null where key like 'grant%';
    delete from public.blueprint where key like 'grant%';
  `);
}

async function noSeriousViolations(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
}

test.beforeAll(() => {
  sql("update public.feature_flag set enabled = true where key = 'wos_objects' and organization_id is null;");
  cleanUp();
});

test.afterAll(() => {
  cleanUp();
  sql("update public.feature_flag set enabled = false where key = 'wos_objects' and organization_id is null;");
});

test("owner builds the Grant starter", async ({ page }) => {
  test.slow();
  await signIn(page, "owner");
  await page.goto("/builder");
  const starters = page.getByRole("region", { name: "Start from a starter" });
  for (const name of ["Recruiting", "Volunteer intake", "Event", "Grant", "Donor stewardship", "Inventory"]) {
    await expect(starters.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await noSeriousViolations(page, "starters");

  await starters.getByRole("button", { name: "Use Grant" }).click();
  await page.waitForURL(/\/builder\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Grant", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Type name (English)")).toHaveCount(3);
  await expect(page.getByLabel("Type name (French)").first()).toHaveValue("Bailleur de fonds");

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByText("Deadlines", { exact: true })).toBeVisible();
  await expect(page.getByText("Grant awarded", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Approve and build" }).click();
  await page.getByRole("button", { name: "Approve blueprint" }).click();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Approved");
  await page.getByRole("button", { name: "Build now" }).click();
  await page.getByRole("group", { name: "Build now" }).getByRole("button", { name: "Build now" }).click();
  await expect(page.getByTestId("blueprint-status")).toHaveText("Built");
  expect(
    sql("select b.counts->>'object_type' from public.blueprint_build b join public.blueprint p on p.id = b.blueprint_id where p.key = 'grant' and b.undone_at is null;"),
  ).toBe("3");
});

test("staff see the starters but cannot use them", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/builder");
  const starters = page.getByRole("region", { name: "Start from a starter" });
  await expect(starters.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(starters.getByRole("button")).toHaveCount(0);
  await signOut(page);
});

test("the starters read in French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/builder");
  const starters = page.getByRole("region", { name: "Partir d’un modèle" });
  await expect(starters.getByRole("heading", { name: "Relations avec les donateurs", exact: true })).toBeVisible();
  await expect(starters.getByRole("button", { name: "Utiliser Inventaire" })).toBeVisible();
  await noSeriousViolations(page, "French starters");
});
