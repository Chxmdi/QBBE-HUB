import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * The work summary (#136, phase 2). Staff reach their own from My work and
 * see the same figures an admin sees; they cannot open anyone else's. An
 * admin opens any listed staff member's from the team overview. A volunteer
 * has none. The role matrix covers the same doors for every role; this spec
 * checks what is behind them.
 */

const id = (email: string) => sql(`select id::text from user_profile where email = '${email}'`);

function overdueTaskFor(userId: string, marker: string) {
  const orgId = sql(
    `select organization_id::text from organization_membership where user_id = '${userId}' limit 1`,
  );
  sql(`insert into task (organization_id, title, created_by, assignee_id, status, due_at)
       values ('${orgId}', '${marker}', '${userId}', '${userId}', 'not_started',
         (now() at time zone coalesce((select timezone from organization where id = '${orgId}'), 'America/Toronto'))::date - 12)`);
}

test("staff see their own work summary and cannot open anyone else's", async ({ page }) => {
  test.setTimeout(120_000);
  const marker = `Summary check ${Date.now()}`;
  const staffId = id("qa-staff@example.com");
  overdueTaskFor(staffId, marker);
  try {
    await signIn(page, "staff");
    await page.goto("/my-work");
    await page.getByRole("link", { name: "My work summary", exact: true }).click();
    await expect(page).toHaveURL(/\/people\/me\/work$/);
    await expect(page.getByRole("heading", { level: 1, name: "My work summary" })).toBeVisible();
    await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
    await expect(page.getByText(/overdue, oldest (1[2-9]|[2-9]\d) days/)).toBeVisible();
    const overdue = page.locator("h3", { hasText: "Overdue" }).locator("xpath=..");
    await expect(overdue.getByRole("link", { name: marker })).toBeVisible();

    // The same page by id is theirs too.
    await page.goto(`/people/${staffId}/work`);
    await expect(page.getByRole("heading", { level: 1, name: "My work summary" })).toBeVisible();

    // Anyone else's is refused, and nothing of it reaches the page.
    await page.goto(`/people/${id("qa-owner@example.com")}/work`);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByText("Work summary for", { exact: false })).toHaveCount(0);
  } finally {
    sql(`delete from task where title = '${marker}'`);
  }
});

test("an admin opens any staff member's summary from the team overview", async ({ page }) => {
  test.setTimeout(120_000);
  const marker = `Summary admin check ${Date.now()}`;
  const staffId = id("qa-staff@example.com");
  overdueTaskFor(staffId, marker);
  try {
    await signIn(page, "admin");
    await page.goto("/people/overview");
    await page.getByRole("link", { name: "Work summary for QA Staff" }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${staffId}/work$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Work summary for QA Staff" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: marker })).toBeVisible();
    await expect(page.getByText(/overdue, oldest (1[2-9]|[2-9]\d) days/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to team overview" })).toBeVisible();

    // A volunteer is not listed, so an admin has no summary to open for one.
    await page.goto(`/people/${id("qa-volunteer@example.com")}/work`);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname).toBe("/");
  } finally {
    sql(`delete from task where title = '${marker}'`);
  }
});

test("a volunteer has no work summary and cannot open a staff member's", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "volunteer");
  for (const path of ["/people/me/work", `/people/${id("qa-staff@example.com")}/work`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).pathname, `volunteer is sent away from ${path}`).toBe("/");
  }
  await page.goto("/my-work");
  await expect(page.getByRole("link", { name: "My work summary" })).toHaveCount(0);
});

test("an admin sets the thresholds, and the overview follows them", async ({ page }) => {
  test.setTimeout(120_000);
  const orgId = sql(
    "select organization_id::text from organization_membership m join user_profile u on u.id = m.user_id where u.email = 'qa-owner@example.com' limit 1",
  );
  try {
    await signIn(page, "admin");
    await page.goto("/admin/team-signals");
    await expect(page.getByRole("heading", { level: 1, name: "Team signals" })).toBeVisible();
    await expect(page.getByLabel("Send each person a gentle reminder when a signal starts")).not.toBeChecked();
    await expect(page.getByLabel("Email owners and admins a weekly digest")).not.toBeChecked();
    await page.getByLabel("Days overdue before flagging").fill("21");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    expect(sql(`select overdue_age_days from team_signal_settings where organization_id = '${orgId}'`)).toBe("21");

    await page.goto("/people/overview");
    await expect(page.getByText("a task overdue by more than 21 days")).toBeVisible();
  } finally {
    sql(`delete from team_signal_settings where organization_id = '${orgId}'`);
  }
});
