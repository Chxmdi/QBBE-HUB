import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Moving a member down takes effect in the app. The owner changes qa-staff
 * from staff to volunteer on the admin page; qa-staff then loses a staff-only
 * screen (receipts) and the change is audited. Their role is put back
 * afterwards whatever happens, because other specs sign in as qa-staff.
 */
test("an administrator moves a staff member down to volunteer and the staff screens close to them", async ({ page }) => {
  test.setTimeout(180_000);
  const restore = () =>
    sql(`update organization_membership set role = 'staff'
         where user_id = (select id from user_profile where email = 'qa-staff@example.com')`);
  const membershipId = sql(`select m.id::text from organization_membership m
     join user_profile p on p.id = m.user_id where p.email = 'qa-staff@example.com'`);
  restore();
  try {
    // Before: a staff member opens the receipts screen.
    await signIn(page, "staff");
    await page.goto("/finance/receipts");
    await expect(page).toHaveURL(/\/finance\/receipts/);
    await signOut(page);

    await signIn(page, "owner");
    await page.goto("/admin");
    const row = page
      .getByRole("region", { name: "Members", exact: true })
      .locator("tr")
      .filter({ hasText: "qa-staff@example.com" });
    const role = row.getByLabel("Member role");
    await expect(role).toHaveValue("staff", { timeout: 30_000 });
    await role.selectOption("volunteer");
    await expect.poll(() => sql(`select role::text from organization_membership where id = '${membershipId}'`), { timeout: 30_000 }).toBe(
      "volunteer",
    );
    await expect(row.getByRole("alert")).toHaveCount(0);
    expect(
      Number(sql(`select count(*) from audit_event where object_id = '${membershipId}' and action = 'role_changed'
                  and created_at > now() - interval '5 minutes'`)),
    ).toBeGreaterThan(0);
    await page.reload();
    await expect(row.getByLabel("Member role")).toHaveValue("volunteer", { timeout: 30_000 });
    await signOut(page);

    // After: the same screen sends them home with the "not yours" notice.
    await signIn(page, "staff");
    await page.goto("/finance/receipts");
    await expect(page).toHaveURL(/denied=1/, { timeout: 30_000 });
  } finally {
    restore();
  }
});
