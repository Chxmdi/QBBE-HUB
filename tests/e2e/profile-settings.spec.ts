import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * A person corrects their own name in Settings; an administrator corrects a
 * member's name from the member's work summary, and the correction is in the
 * audit trail. Who may change which profile column is proven in
 * supabase/tests/profile-and-vms.sql.
 */

const nameOf = (email: string) => sql(`select full_name from user_profile where email = '${email}'`);

test("a volunteer corrects their own name in Settings", async ({ page }) => {
  const original = nameOf("qa-volunteer@example.com");
  const renamed = `QA Volunteer ${Date.now()}`;
  try {
    await signIn(page, "volunteer");
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute("readonly", "");
    await page.getByLabel("Name", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
    expect(nameOf("qa-volunteer@example.com")).toBe(renamed);
  } finally {
    sql(`update user_profile set full_name = '${original.replace(/'/g, "''")}' where email = 'qa-volunteer@example.com'`);
  }
});

test("an administrator corrects a member's name and the correction is audited", async ({ page }) => {
  const staffId = sql(`select id from user_profile where email = 'qa-staff@example.com'`);
  const original = nameOf("qa-staff@example.com");
  const corrected = `QA Staff ${Date.now()}`;
  try {
    await signIn(page, "owner");
    await page.goto(`/people/${staffId}/work`);
    await page.getByRole("button", { name: "Correct name or title" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill(corrected);
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: corrected, level: 2 })).toBeVisible();
    expect(
      sql(`select count(*) from audit_event where action = 'profile_rectified' and object_id = '${staffId}'
           and metadata->'after'->>'full_name' = '${corrected}'`),
    ).toBe("1");
  } finally {
    sql(`update user_profile set full_name = '${original.replace(/'/g, "''")}' where id = '${staffId}'`);
  }
});
