import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Voiding a gift recorded by mistake, through the app: the owner records a
 * gift, voids it from its page, and the gift stays on record marked void with
 * a posted entry that reverses its ledger entry line for line. Gifts are
 * permanent by design, so each run uses a donor of its own.
 */
test("the owner voids a gift and its ledger entry is reversed", async ({ page }) => {
  test.setTimeout(240_000);
  const donor = `Void Donor ${Date.now()}`;
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);

  // The books open for October 2026, as the other ledger specs set them.
  sql(`update ledger_settings set chart_approved_on = '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now() where organization_id = '${orgId}' and chart_approved_on is null`);
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${orgId}', to_char(m, 'YYYY-MM'), m::date, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2026-10-01', date '2027-09-01', interval '1 month') as m
       where not exists (select 1 from ledger_period p where p.organization_id = '${orgId}' and p.starts_on = m::date)`);
  sql(`insert into crm_contact (organization_id, full_name, email) values ('${orgId}', '${donor}', 'void-donor@example.com')`);

  await signIn(page, "owner");
  await page.goto("/finance/gifts");
  await clickWhenInteractive(page.getByRole("button", { name: "Record a gift" }));
  const record = page.getByRole("dialog", { name: "Record a gift" });
  await record.getByLabel("Date received").fill("2026-10-15");
  await record.getByLabel("Donor", { exact: true }).selectOption({ label: donor });
  await record.getByLabel("Amount received").fill("80.00");
  await expect(record.getByLabel("Debit")).toHaveValue(/.+/);
  await clickWhenInteractive(record.getByRole("button", { name: "Record and post" }));
  await expect(page.getByRole("heading", { name: /^Gift \d+$/ })).toBeVisible({ timeout: 20_000 });

  const giftId = sql(`select g.id::text from gift g join crm_contact c on c.id = g.crm_contact_id where c.full_name = '${donor}'`);
  expect(giftId).toMatch(/^[0-9a-f-]{36}$/);

  await clickWhenInteractive(page.getByRole("button", { name: "Void gift" }));
  const dialog = page.getByRole("dialog", { name: "Void this gift" });
  await dialog.getByLabel("Date of the reversing entry").fill("2026-10-20");
  await dialog.getByLabel("Reason").fill("Recorded twice");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Void and reverse" }));
  await expect(page.getByText("Gift voided and its ledger entry reversed.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Void gift" })).toHaveCount(0);

  expect(sql(`select status || '|' || void_reason from gift where id = '${giftId}'`)).toBe("voided|Recorded twice");
  // The reversal is posted, dated as asked, and mirrors the original entry.
  expect(
    sql(`select r.status || '|' || r.entry_date from gift g join journal_entry r on r.id = g.void_entry_id where g.id = '${giftId}'`),
  ).toBe("posted|2026-10-20");
  expect(
    sql(`select count(*) from gift g
         join journal_line o on o.entry_id = g.journal_entry_id
         join journal_line r on r.entry_id = g.void_entry_id
           and r.account_id = o.account_id and r.debit_cents = o.credit_cents and r.credit_cents = o.debit_cents
         where g.id = '${giftId}'`),
  ).toBe(sql(`select count(*) from gift g join journal_line o on o.entry_id = g.journal_entry_id where g.id = '${giftId}'`));
  expect(
    Number(sql(`select count(*) from audit_event where object_id = '${giftId}' and action = 'gift_voided'`)),
  ).toBe(1);
});
