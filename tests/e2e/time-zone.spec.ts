import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

// A zone saved before saving was checked (or written straight to the
// database) used to throw a RangeError while Home formatted the greeting, so
// its owner saw the error page instead of their workspace.
test("a person whose saved time zone is not real still gets Home and their notification settings", async ({ page }) => {
  const before = sql(`select coalesce(timezone, '') from user_profile where email = 'qa-staff@example.com';`);
  sql(`update user_profile set timezone = 'Mars/Olympus' where email = 'qa-staff@example.com';`);
  try {
    await signIn(page, "staff");
    await page.goto("/");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/settings/notifications");
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.getByLabel("Work assigned to me")).toBeVisible();
  } finally {
    sql(`update user_profile set timezone = ${before ? `'${before}'` : "null"} where email = 'qa-staff@example.com';`);
  }
});

// The server runs in UTC. A meeting at 21:00 in Toronto (01:00Z the next
// day) used to sit on the next day's column at "1:00 AM".
test("the calendar puts an evening meeting on its workspace day and time", async ({ page }) => {
  const title = `TZ evening ${Date.now().toString(36)}`;
  const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
  sql(`
    insert into public.meeting (organization_id, title, organizer_id, starts_at)
    select organization_id, '${title}', '${owner}', '2026-10-24T01:00:00Z'
    from public.organization_membership where user_id = '${owner}';
  `);
  try {
    await signIn(page, "owner");
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/calendar?view=week&date=2026-10-22");
    const friday = page.locator('[data-day="2026-10-23"]');
    const chip = friday.getByRole("link", { name: new RegExp(title) });
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText("9:00 p.m.");
    await expect(page.locator('[data-day="2026-10-24"]').getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
  } finally {
    sql(`delete from public.meeting where title = '${title}'`);
  }
});
