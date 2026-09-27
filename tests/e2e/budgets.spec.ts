import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Budgets against actuals (#153): the owner creates a budget, adds an evenly
 * phased line and a custom one, approves it (which locks it), reads budget
 * against actual on screen and in the CSV, and starts a revision. Staff who
 * do not read the ledger see no budgets; as a program lead they see their
 * program's summary. Approved budgets and posted entries are permanent by
 * design, so each run uses its own far-future fiscal year rather than
 * cleaning up.
 */
test("the owner budgets, approves and compares with actuals; a program lead sees only a summary", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const year = 2100 + (Math.floor(stamp / 1000) % 7900);
  const first = `${year}-10`;
  const marker = `Budget check ${stamp}`;
  const slug = `budget-e2e-${stamp}`;
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);

  // The fiscal year's periods, a program, and one posted entry: $80.00 of
  // rent for the program in the first month.
  sql(`
    do $$
    declare
      v_org uuid;
      v_program uuid;
      v_entry uuid;
      v_month date;
    begin
      select organization_id into strict v_org from organization_membership where user_id = '${ownerId}' limit 1;
      update ledger_settings set chart_approved_on = coalesce(chart_approved_on, date '2026-09-20'),
        chart_approved_by_name = coalesce(chart_approved_by_name, 'QA Accountant, CPA'),
        chart_approval_recorded_at = coalesce(chart_approval_recorded_at, now())
      where organization_id = v_org;
      for i in 0..11 loop
        v_month := (date '${first}-01' + make_interval(months => i))::date;
        insert into ledger_period (organization_id, name, starts_on, ends_on)
        select v_org, to_char(v_month, 'YYYY-MM'), v_month, (v_month + interval '1 month' - interval '1 day')::date
        where not exists (select 1 from ledger_period where organization_id = v_org and starts_on = v_month);
      end loop;
      insert into program (organization_id, name, slug, created_by)
      values (v_org, '${marker} program', '${slug}', '${ownerId}') returning id into v_program;
      insert into journal_entry (organization_id, entry_date, memo)
      values (v_org, date '${first}-05', '${marker}') returning id into v_entry;
      insert into journal_line (organization_id, entry_id, line_no, account_id, fund_id, program_id, debit_cents, credit_cents)
      select v_org, v_entry, 1, a.id, f.id, v_program, 8000, 0
      from ledger_account a, ledger_fund f
      where a.organization_id = v_org and a.code = '5200' and f.organization_id = v_org and f.code = 'GEN';
      insert into journal_line (organization_id, entry_id, line_no, account_id, fund_id, debit_cents, credit_cents)
      select v_org, v_entry, 2, a.id, f.id, 0, 8000
      from ledger_account a, ledger_fund f
      where a.organization_id = v_org and a.code = '1000' and f.organization_id = v_org and f.code = 'GEN';
      perform app.ledger_post(v_entry);
    end
    $$;
  `);
  const programId = sql(`select id::text from program where slug = '${slug}'`);
  page.on("dialog", (dialog) => void dialog.accept());

  await signIn(page, "owner");
  await page.goto("/finance/budgets");
  await expect(page.getByRole("heading", { name: "Budgets", exact: true })).toBeVisible();
  await page.getByLabel("First month of the fiscal year").fill(first);
  await page.getByLabel("Name", { exact: true }).fill(marker);
  await clickWhenInteractive(page.getByRole("button", { name: "Create budget" }));
  await expect(page.getByRole("heading", { name: marker, exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  const budgetUrl = page.url();

  // $1,200.00 of rent for the program, split evenly.
  await clickWhenInteractive(page.getByRole("button", { name: "Add line" }));
  let dialog = page.getByRole("dialog", { name: "Add a budget line" });
  await dialog.getByLabel("Account").selectOption({ label: "5200 Rent" });
  await dialog.getByLabel("Program").selectOption({ label: `${marker} program` });
  await dialog.getByLabel("Annual amount").fill("1200.00");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Save line" }));
  await expect(page.getByRole("cell", { name: "Rent", exact: true })).toBeVisible({ timeout: 20_000 });

  // Donations phased by hand: $500.00 in the first month only.
  await clickWhenInteractive(page.getByRole("button", { name: "Add line" }));
  dialog = page.getByRole("dialog", { name: "Add a budget line" });
  await dialog.getByLabel("Account").selectOption({ label: "4200 Donations" });
  await dialog.getByLabel("Custom amount per month").check();
  await dialog.getByLabel(`Oct ${year}`).fill("500");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Save line" }));
  await expect(page.getByRole("cell", { name: "Donations", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("cell", { name: "Custom", exact: true })).toBeVisible();

  // Approval locks it.
  await clickWhenInteractive(page.getByRole("button", { name: "Approve budget" }));
  await expect(page.getByText("Approved", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit line/ })).toHaveCount(0);

  // Budget against actual for the first month.
  await page.goto(`${budgetUrl}/report?month=${first}`);
  await expect(page.getByRole("heading", { name: "Budget vs actual" })).toBeVisible();
  const rent = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Rent", exact: true }) });
  const cells = await rent.getByRole("cell").allTextContents();
  expect(cells.slice(2, 6)).toEqual(["$100.00", "$80.00", "$20.00", "+20.0%"]);

  const budgetId = budgetUrl.split("/").pop();
  const csv = await page.request.get(`/api/finance/budgets/${budgetId}/report?month=${first}&program=${programId}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain(`Program ${marker} program.`);
  expect(body).toContain("5200,Rent,Expense,100.00,80.00,20.00,20.0,100.00,80.00,20.00,20.0,1200.00");
  expect(body, "the program filter leaves out the organization-wide donations line").not.toContain("4200,Donations");

  // A revision is a new draft version; the approved one stays.
  await page.goto(budgetUrl);
  await clickWhenInteractive(page.getByRole("button", { name: "Revise budget" }));
  await expect(page.getByText("Version 2 (this one)")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Version 1" })).toBeVisible();
  await clickWhenInteractive(page.getByRole("button", { name: "Delete draft" }));
  await expect(page.getByRole("link", { name: marker, exact: true })).toBeVisible({ timeout: 20_000 });
  await signOut(page);

  // Staff who do not read the ledger see no budgets, even as a program lead,
  // and as the lead they see their program's summary.
  try {
    sql(`update program set lead_id = '${staffId}' where id = '${programId}'`);
    await signIn(page, "staff");
    await page.goto("/finance/budgets");
    await expect(page.getByText("You do not have access to budgets")).toBeVisible();
    expect((await page.request.get(`/api/finance/budgets/${budgetId}/report`)).status()).toBe(403);

    await page.goto(`/finance/budgets/programs?program=${programId}&month=${first}`);
    await expect(page.getByRole("heading", { name: "My programs" })).toBeVisible();
    const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Rent", exact: true }) });
    expect((await row.getByRole("cell").allTextContents()).slice(2, 4)).toEqual(["$100.00", "$80.00"]);
    await expect(page.getByRole("cell", { name: "Donations", exact: true })).toHaveCount(0);
  } finally {
    sql(`update program set lead_id = null where id = '${programId}'`);
  }
});
