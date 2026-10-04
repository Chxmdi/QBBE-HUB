import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Audit M6: the menu listed Ledger, Budgets, GST and QST, Bank, Gifts and
 * Payroll to every staff member, and each answered "You do not have access"
 * unless an administrator had made that person a ledger reader. The menus
 * now follow the same read rule as the screens.
 */

const LEDGER_SCREENS = ["Ledger", "Budgets", "GST and QST", "Bank", "Gifts and grants", "Payroll"];

test("staff see the ledger screens in the menu only once they are ledger readers", async ({ page }) => {
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);
  try {
    await signIn(page, "staff");
    await page.goto("/finance/receipts");
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Receipts", exact: true })).toBeVisible();
    for (const name of LEDGER_SCREENS) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);

    sql(`
      insert into ledger_reader (organization_id, user_id)
      select m.organization_id, m.user_id from organization_membership m
      where m.user_id = '${staffId}' and m.status = 'active'
      on conflict do nothing`);
    await page.reload();
    for (const name of LEDGER_SCREENS) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Ledger", exact: true }).click();
    await expect(page).toHaveURL(/\/finance\/ledger$/);
    await expect(page.getByText("You do not have access")).toHaveCount(0);
  } finally {
    sql(`delete from ledger_reader where user_id = '${staffId}'`);
  }
});
