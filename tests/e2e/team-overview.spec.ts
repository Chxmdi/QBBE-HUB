import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Team overview (#136): an owner sees each staff member's assigned work, and
 * someone whose work has slipped is flagged with the reason in words. Who may
 * open the page at all is covered by the role matrix.
 */
test("the owner sees a staff member with slipped work flagged, with the reason", async ({ page }) => {
  test.setTimeout(120_000);
  const marker = `Overview check ${Date.now()}`;
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(
    `select organization_id::text from organization_membership where user_id = '${staffId}' limit 1`,
  );

  // Twelve days overdue: past the 7-day threshold on its own.
  sql(
    `insert into task (organization_id, title, created_by, assignee_id, status, due_at)
     values ('${orgId}', '${marker}', '${staffId}', '${staffId}', 'not_started', current_date - 12)`,
  );

  try {
    await signIn(page, "owner");
    await page.goto("/people");
    await page.getByRole("link", { name: "Team overview", exact: true }).click();
    await expect(page).toHaveURL(/\/people\/overview$/);
    await expect(page.getByRole("heading", { name: "Team overview" })).toBeVisible();

    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: /QA Staff/ }) });
    await expect(row).toBeVisible();
    await expect(row.getByText("Needs attention", { exact: true })).toBeVisible();
    await expect(row.getByText(/overdue, oldest (1[2-9]|[2-9]\d) days/)).toBeVisible();

    // Volunteers and guests are not part of this view.
    await expect(page.getByRole("rowheader", { name: /QA Volunteer/ })).toHaveCount(0);
    await expect(page.getByRole("rowheader", { name: /QA Guest/ })).toHaveCount(0);
  } finally {
    sql(`delete from task where title = '${marker}'`);
  }
});
