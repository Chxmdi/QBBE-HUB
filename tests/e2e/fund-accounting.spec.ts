import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Fund accounting (#149): the owner releases part of a restricted grant to the
 * general fund once its condition is met, is refused when asking for more than
 * the grant holds, and then sees the release on the statement of changes in
 * fund balances and in its CSV. Staff who are not ledger readers see nothing.
 *
 * Posted entries are permanent by design, so each run uses a fund of its own
 * rather than cleaning up. Refusals for unrestricted funds and closed periods
 * are covered by the database suite (supabase/tests/fund-accounting.sql).
 */
test("the owner releases restricted money and sees it on the statement of changes in fund balances", async ({ page }) => {
  test.setTimeout(240_000);
  const suffix = Date.now().toString(36).toUpperCase();
  const code = `E2E-${suffix}`;
  const fundName = `E2E grant ${suffix}`;
  const condition = `Funder accepted report ${suffix}`;
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);

  // The fiscal year the other ledger specs use, the accountant's approval,
  // and a restricted grant of 500.00 received on 2026-10-03.
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${orgId}', to_char(m, 'YYYY-MM'), m::date, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2026-10-01', date '2027-09-01', interval '1 month') as m
       where not exists (select 1 from ledger_period p where p.organization_id = '${orgId}' and p.starts_on = m::date)`);
  sql(`update ledger_settings set chart_approved_on = date '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now()
       where organization_id = '${orgId}' and chart_approved_on is null`);
  const fundId = sql(`insert into ledger_fund (organization_id, code, name, restriction, funder)
     values ('${orgId}', '${code}', '${fundName}', 'externally_restricted', 'E2E funder') returning id::text`);
  sql(`do $$
       declare v_entry uuid;
       begin
         insert into journal_entry (organization_id, entry_date, memo)
         values ('${orgId}', date '2026-10-03', 'E2E grant received ${suffix}') returning id into v_entry;
         insert into journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents, credit_cents)
         values
           ('${orgId}', v_entry, 1, (select id from ledger_account where organization_id = '${orgId}' and code = '1000'),
            '${fundId}', 50000, 0),
           ('${orgId}', v_entry, 2, (select id from ledger_account where organization_id = '${orgId}' and code = '4010'),
            '${fundId}', 0, 50000);
         perform app.ledger_post(v_entry);
       end $$`);

  await signIn(page, "owner");
  await page.goto("/finance/ledger/funds");
  await clickWhenInteractive(page.getByRole("link", { name: "Release restricted money" }));
  await expect(page.getByRole("heading", { name: "Release restricted money", exact: true })).toBeVisible();

  // More than the grant holds is refused, and nothing is posted.
  await page.getByLabel("From restricted fund").selectOption({ label: `${code} ${fundName}` });
  await page.getByLabel("To unrestricted fund").selectOption({ label: "GEN General fund" });
  await page.getByLabel("Amount").fill("600.00");
  await page.getByLabel("Release date").fill("2026-10-05");
  await page.getByLabel("Condition met").fill(condition);
  await clickWhenInteractive(page.getByRole("button", { name: "Release and post" }));
  await expect(page.getByRole("alert").filter({ hasText: `Fund ${code} has only 500.00 available` })).toBeVisible({
    timeout: 20_000,
  });

  // 200.00 is released and posted with the condition in its memo.
  await page.getByLabel("Amount").fill("200.00");
  await clickWhenInteractive(page.getByRole("button", { name: "Release and post" }));
  const releaseRow = page.getByRole("row").filter({ hasText: condition });
  await expect(releaseRow).toBeVisible({ timeout: 20_000 });
  await expect(releaseRow).toContainText("$200.00");
  await expect(releaseRow).toContainText(`${code} ${fundName}`);
  const memo = sql(`select e.memo from ledger_fund_release r join journal_entry e on e.id = r.entry_id
     where r.from_fund_id = '${fundId}' and e.status = 'posted'`);
  expect(memo).toBe(`Release from restricted fund ${code} to GEN. Condition met: ${condition}`);

  // The statement of changes in fund balances shows it.
  await page.goto("/finance/ledger/statements?year=2026-10-01");
  await expect(
    page.getByRole("heading", { name: "Statement of changes in fund balances, 2026-10-01 to 2027-09-30" }),
  ).toBeVisible();
  const fundRow = page.getByRole("row").filter({ hasText: fundName });
  await expect(fundRow).toContainText("$500.00");
  await expect(fundRow).toContainText("($200.00)");
  await expect(fundRow).toContainText("$300.00");
  await expect(page.getByRole("link", { name: "Changes in fund balances CSV" })).toBeVisible();

  const csv = await page.request.get("/api/finance/ledger/statements?year=2026-10-01&statement=fund-changes");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).replace(/^﻿/, "").split("\r\n");
  expect(lines[1]).toBe(
    "Fund,Name,Restriction,Balance 2026-10-01,Revenue,Expenses,Transfers and releases,Balance 2027-09-30",
  );
  expect(lines).toContain(`${code},${fundName},Externally restricted,0.00,500.00,0.00,'-200.00,300.00`);

  // The statement's closing balances match the Funds page's balances.
  const mismatches = sql(`select count(*) from ledger_fund_changes('${orgId}', date '2026-10-01', date '2027-09-30') c
     join ledger_fund_balances('${orgId}', date '2027-09-30') b on b.fund_id = c.fund_id
     where c.closing_cents <> b.fund_balance_cents`);
  expect(Number(mismatches), "closing balances equal the fund balances").toBe(0);
  await signOut(page);

  // Staff who are not ledger readers see neither the releases nor the statement.
  await signIn(page, "staff");
  await page.goto("/finance/ledger/funds/release");
  await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
  await expect(page.getByText(condition)).toHaveCount(0);
  expect(
    (await page.request.get("/api/finance/ledger/statements?year=2026-10-01&statement=fund-changes")).status(),
  ).toBe(403);
});
