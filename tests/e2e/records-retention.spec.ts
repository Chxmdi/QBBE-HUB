import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Issue #146 — records retention rules and legal hold.
 *
 * The database tests prove the guarantees. This proves an administrator can
 * actually use them: see the rules and what still needs confirming, set the
 * fiscal year end, and place and release a hold, with each step audited.
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("an administrator places and releases a legal hold on a record category", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const reason = `E2E dispute ${stamp}`;

  await signIn(page, "owner");
  await page.goto("/admin/records");
  await expect(page.getByRole("heading", { name: "Records & holds", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const rules = page.getByRole("region", { name: "Retention rules" });
  await expect(rules.getByText("Financial records", { exact: true })).toBeVisible();
  await expect(rules.getByText("Needs accountant confirmation").first()).toBeVisible();

  // Fiscal year end.
  await page.getByLabel("Month").selectOption("3");
  await page.getByLabel("Day", { exact: true }).fill("31");
  await page.getByRole("button", { name: "Save year end" }).click();
  await expect(page.getByText("Financial records are counted from March 31.")).toBeVisible({
    timeout: 30_000,
  });

  // Place a hold on every bill.
  await page.getByLabel("Hold", { exact: true }).selectOption("category");
  const holds = page.getByRole("region", { name: "Legal holds" });
  await holds.getByLabel("Category", { exact: true }).selectOption("bill");
  await page.getByLabel("Reason", { exact: true }).fill(reason);
  await page.getByRole("button", { name: "Place hold" }).click();
  const held = page.locator("li", { hasText: reason });
  await expect(held).toBeVisible({ timeout: 30_000 });
  await expect(held.getByText("All bills and invoices")).toBeVisible();

  // Release it, with a reason.
  await held.getByRole("button", { name: "Release" }).click();
  await held.getByLabel("Why is the hold being released?").fill(`Settled ${stamp}`);
  await held.getByRole("button", { name: "Release hold" }).click();
  await expect(page.locator("li", { hasText: reason })).toHaveCount(0, { timeout: 30_000 });

  const audited = sql(`
    select string_agg(e.action, ',' order by e.created_at)
      from audit_event e
      join legal_hold h on h.id = e.object_id
     where h.reason = '${reason}' and e.actor_id = '${OWNER}';
  `).trim();
  expect(audited).toBe("placed,released");

  // Holds are never deleted through the application; the fixture is removed
  // directly (no signed-in user) so reruns start clean.
  sql(`delete from legal_hold where reason = '${reason}';`);
  sql(`delete from record_retention_setting
        where organization_id = (select organization_id from organization_membership
                                  where user_id = '${OWNER}' limit 1);`);
});
