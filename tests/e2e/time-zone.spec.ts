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
