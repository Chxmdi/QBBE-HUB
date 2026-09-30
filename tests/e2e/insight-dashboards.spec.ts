import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

/**
 * Advanced dashboards (V2-5): role templates (Executive, Finance,
 * Programmes), cross-programme totals and twelve-week trends with a table
 * alternative. Hidden until the lenses switch is on.
 */
test("the dashboards show role templates, programme totals and trends with a table view", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Dash ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const program = sql(
    `insert into program (organization_id, name, slug, created_by)
     values ('${orgId}', '${marker} programme', 'dash-${Date.now()}', '${ownerId}') returning id`,
  );
  // Two open tasks in the programme (one overdue) and one finished this week.
  sql(
    `insert into task (organization_id, program_id, title, created_by, status, due_at, completed_at) values
       ('${orgId}', '${program}', '${marker} overdue', '${ownerId}', 'in_progress', current_date - 5, null),
       ('${orgId}', '${program}', '${marker} open', '${ownerId}', 'not_started', current_date + 5, null),
       ('${orgId}', '${program}', '${marker} done', '${ownerId}', 'completed', null, now())`,
  );

  const before = setLensesSwitch(false);
  try {
    await signIn(page, "owner");
    await page.goto("/insight/dashboards");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();

    setLensesSwitch(true);
    await page.goto("/insight/dashboards");
    await expect(page.getByRole("heading", { name: "Dashboards", exact: true })).toBeVisible();
    const templates = page.getByRole("navigation", { name: "Dashboard" });
    await expect(templates.getByRole("link", { name: "Executive" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("term").filter({ hasText: "Open tasks" })).toBeVisible();
    await expect(page.getByRole("term").filter({ hasText: "Overdue tasks" })).toBeVisible();

    // The programme's own row in the totals table: 2 open, 1 overdue, 1 done.
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: `${marker} programme` }) });
    await expect(row.getByRole("cell")).toHaveText(["0", "2", "1", "1", "0"]);

    // The trend chart has a spoken summary and a table behind a keyboard toggle.
    await expect(page.getByRole("img", { name: /^Tasks completed per week: \d+ over twelve weeks, [1-9]\d* this week/ })).toBeVisible();
    const toggle = page.getByText("Show as a table").first();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("columnheader", { name: "Week of" }).first()).toBeVisible();
    await expectAccessible(page);

    // Finance: the owner (with two-step sign-in) sees the money tiles.
    await templates.getByRole("link", { name: "Finance" }).click();
    await expect(page).toHaveURL(/template=finance/);
    await expect(page.getByRole("term").filter({ hasText: "Gifts received this year" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Totals by programme" })).toHaveCount(0);
    await expectAccessible(page);

    await templates.getByRole("link", { name: "Programmes" }).click();
    await expect(page.getByRole("term").filter({ hasText: "Outcome measurements, last 90 days" })).toBeVisible();
    await expect(page.getByRole("img", { name: /^Tasks created per week/ })).toBeVisible();

    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tableaux de bord", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Totaux par programme" })).toBeVisible();
  } finally {
    setLensesSwitch(before);
    sql(`delete from task where title like '${marker}%'`);
    sql(`delete from program where id = '${program}'`);
  }
});
