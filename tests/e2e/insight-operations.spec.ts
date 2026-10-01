import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { expectAccessible, qaIds, setLensesSwitch } from "./insight";

/**
 * Operations analytics (V3-5): workload per person, overdue patterns, and a
 * goal trajectory tile on the Operations page and on the Programmes
 * dashboard. Hidden until the lenses switch is on.
 */
test("operations is hidden while the switch is off [switch off]", async ({ page }) => {
  const before = setLensesSwitch(false);
  try {
    await signIn(page, "owner");
    await page.goto("/insight/operations");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    setLensesSwitch(before);
  }
});

test("operations shows workload, overdue patterns and goal trajectories", async ({ page }) => {
  test.setTimeout(150_000);
  const marker = `Ops ${Date.now()}`;
  const { ownerId, orgId } = qaIds();
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const before = setLensesSwitch(true);
  let program = "";
  let project = "";
  try {
    program = sql(
      `insert into program (organization_id, name, slug, created_by)
       values ('${orgId}', '${marker} programme', 'ops-${Date.now()}', '${ownerId}') returning id`,
    );
    project = sql(
      `insert into project (organization_id, program_id, name, owner_id, created_by)
       values ('${orgId}', '${program}', '${marker} project', '${ownerId}', '${ownerId}') returning id`,
    );
    // Twelve days overdue, high priority, assigned to QA Staff.
    sql(
      `insert into task (organization_id, project_id, title, assignee_id, priority, due_at, created_by, created_at)
       values ('${orgId}', '${project}', '${marker} late', '${staffId}', 'high', current_date - 12, '${ownerId}', now() - interval '20 days')`,
    );
    // Half way to a target of 100 but only at 20: behind.
    const metric = sql(
      `insert into outcome_metric (organization_id, program_id, name, unit, baseline, baseline_on, target, target_on, created_by)
       values ('${orgId}', '${program}', '${marker} goal', 'people', 0, current_date - 100, 100, current_date + 100, '${ownerId}') returning id`,
    );
    sql(
      `insert into outcome_measurement (organization_id, metric_id, measured_on, value, recorded_by) values
         ('${orgId}', '${metric}', current_date - 40, 10, '${ownerId}'),
         ('${orgId}', '${metric}', current_date - 5, 20, '${ownerId}')`,
    );

    await signIn(page, "owner");
    await page.goto("/insight/operations");
    await expect(page.getByRole("heading", { name: "Operations", exact: true })).toBeVisible();

    const staffRow = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /QA Staff/ }) });
    await expect(staffRow).toBeVisible();
    await expect(page.getByRole("img", { name: /^Open tasks at the end of each week: \d+ now/ })).toBeVisible();

    await expect(page.getByRole("term").filter({ hasText: "8 to 30 days late" })).toBeVisible();
    const projectRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: `${marker} project` }) });
    await expect(projectRow.getByRole("cell")).toHaveText("1");
    await expect(page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "High", exact: true }) })).toBeVisible();

    const goal = page.getByRole("article", { name: `${marker} goal` });
    await expect(goal).toContainText("Behind");
    await expect(goal).toContainText("Latest: 20 people");
    await expect(goal.getByRole("img", { name: new RegExp(`${marker} goal: 2 measurements, latest 20 people\\. Behind\\.`) })).toBeVisible();
    await expectAccessible(page);

    // The same tile on the Programmes dashboard.
    await page.goto("/insight/dashboards?template=programs");
    await expect(page.getByRole("article", { name: `${marker} goal` })).toContainText("Behind");

    await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: page.url() }]);
    await page.goto("/insight/operations");
    await expect(page.getByRole("heading", { name: "Opérations", exact: true })).toBeVisible();
    await expect(page.getByRole("article", { name: `${marker} goal` })).toContainText("En retard");
  } finally {
    setLensesSwitch(before);
    if (project) sql(`delete from project where id = '${project}'`);
    if (program) sql(`delete from program where id = '${program}'`);
  }
});
