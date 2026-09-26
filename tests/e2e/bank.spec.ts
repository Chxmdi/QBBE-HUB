import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Bank import and reconciliation (#151): the owner adds a bank account tied
 * to a ledger cash account, imports a statement (twice, adding nothing the
 * second time), creates entries for lines the ledger does not have, accepts a
 * suggested match, and reconciles the month only once the difference is zero,
 * then downloads the report. Staff without a ledger grant see nothing.
 *
 * Posted entries and reconciled statements are permanent by design, so each
 * run uses its own ledger cash account and a month no other spec touches.
 */
test("the owner imports a statement, matches it and reconciles the month at a zero difference", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const code = String(100000 + (stamp % 900000)).slice(0, 6);
  const orgId = sql(
    `select organization_id::text from organization_membership m join user_profile u on u.id = m.user_id
     where u.email = 'qa-owner@example.com' limit 1`,
  );
  const cashName = `Bank e2e ${stamp}`;

  // Books ready for March 2031: the chart approved and the month open. As the
  // database owner, so this spec does not depend on the ledger spec's order.
  sql(`
    update ledger_settings set chart_approved_on = date '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
      chart_approval_recorded_at = coalesce(chart_approval_recorded_at, now())
    where organization_id = '${orgId}' and chart_approved_on is null;
    insert into ledger_period (organization_id, name, starts_on, ends_on)
    select '${orgId}', '2031-03', date '2031-03-01', date '2031-03-31'
    where not exists (select 1 from ledger_period where organization_id = '${orgId}' and starts_on = date '2031-03-01');
    insert into ledger_account (organization_id, code, name, account_type)
    values ('${orgId}', '${code}', '${cashName}', 'asset');
  `);

  await signIn(page, "owner");
  await page.goto("/finance/bank");
  await expect(page.getByRole("heading", { name: "Bank", exact: true })).toBeVisible();

  await clickWhenInteractive(page.getByRole("button", { name: "Add bank account" }));
  const dialog = page.getByRole("dialog", { name: "Add a bank account" });
  await dialog.getByLabel("Name").fill(`Chequing ${stamp}`);
  await dialog.getByLabel("Bank", { exact: true }).selectOption({ label: "TD Canada Trust" });
  await dialog.getByLabel("Last four digits").fill("4321");
  await dialog.getByLabel("Ledger cash account").selectOption({ label: `${code} ${cashName}` });
  await dialog.getByLabel("Reconcile from").fill("2031-03-01");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Save" }));
  await page.getByRole("link", { name: `Chequing ${stamp} ···4321` }).click();
  await expect(page.getByRole("heading", { name: `Chequing ${stamp} ···4321` })).toBeVisible();
  const accountUrl = page.url().split("?")[0];

  // Import, then import the same file again: nothing is added twice.
  const statement = {
    name: "march.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`03/02/2031,E2E DEPOSIT ${stamp},,100.00,100.00\n03/03/2031,E2E FEE ${stamp},7.50,,92.50\n`),
  };
  for (const expected of [/Imported 2 new lines/, /Imported 0 new lines; 2 already imported were skipped/]) {
    await page.getByLabel("Statement file (CSV, OFX or QFX)").setInputFiles(statement);
    await page.getByLabel("File layout").selectOption("td");
    await clickWhenInteractive(page.getByRole("button", { name: "Import statement" }));
    await expect(page.getByText(expected)).toBeVisible({ timeout: 20_000 });
  }
  expect(sql(`select count(*) from bank_transaction t join bank_account b on b.id = t.bank_account_id
    where b.name = 'Chequing ${stamp}'`)).toBe("2");

  await page.goto(`${accountUrl}?month=2031-03`);
  await expect(page.getByText("2 lines, 2 not matched.")).toBeVisible();

  // Lines the ledger does not have become entries, posted and matched.
  for (const [line, account] of [
    [`2031-03-02 E2E DEPOSIT ${stamp}`, "4200 Donations"],
    [`2031-03-03 E2E FEE ${stamp}`, "5800 Bank charges"],
  ]) {
    await clickWhenInteractive(page.getByRole("button", { name: `Create entry for ${line}` }));
    const create = page.getByRole("dialog", { name: "Create a ledger entry" }).filter({ visible: true });
    await create.getByLabel("Other account").selectOption({ label: account });
    await clickWhenInteractive(create.getByRole("button", { name: "Post and match" }));
    await expect(page.getByRole("button", { name: `Unmatch ${line}` })).toBeVisible({ timeout: 20_000 });
  }

  // Undone, the fee's own entry comes back as the suggestion.
  const fee = `2031-03-03 E2E FEE ${stamp}`;
  await clickWhenInteractive(page.getByRole("button", { name: `Unmatch ${fee}` }));
  await clickWhenInteractive(page.getByRole("button", { name: `Accept suggested match for ${fee}` }));
  await expect(page.getByRole("button", { name: `Unmatch ${fee}` })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("2 lines, 0 not matched.")).toBeVisible();

  // A wrong closing balance cannot be reconciled; the right one can.
  await page.getByLabel("Statement from").fill("2031-03-01");
  await page.getByLabel("Statement to").fill("2031-03-31");
  await page.getByLabel("Opening balance").fill("0.00");
  await page.getByLabel("Closing balance").fill("92.51");
  await clickWhenInteractive(page.getByRole("button", { name: "Start reconciliation" }));
  await expect(page.getByRole("heading", { name: "Reconciliation 2031-03-01 to 2031-03-31" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/The difference is \$0\.01; it must be zero/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark reconciled" })).toBeDisabled();

  await page.getByLabel("Statement closing balance").fill("92.50");
  await clickWhenInteractive(page.getByRole("button", { name: "Save balances" }));
  await expect(page.getByText("Everything matches and the difference is zero.")).toBeVisible({ timeout: 20_000 });
  await clickWhenInteractive(page.getByRole("button", { name: "Mark reconciled" }));
  await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible({ timeout: 20_000 });

  const recId = page.url().split("/").pop();
  const csv = await page.request.get(`/api/finance/bank/reconciliations/${recId}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain("Statement closing balance,92.50");
  expect(body).toContain("Difference (closing balance less cleared ledger balance),0.00");
  expect(body).toContain(`E2E FEE ${stamp}`);

  // Reconciled lines are locked.
  await page.goto(`${accountUrl}?month=2031-03`);
  await expect(page.getByRole("button", { name: `Unmatch ${fee}` })).toHaveCount(0);
  await signOut(page);

  // Staff without a ledger grant see nothing and cannot download the report.
  await signIn(page, "staff");
  await page.goto("/finance/bank");
  await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
  expect((await page.request.get(`/api/finance/bank/reconciliations/${recId}`)).status()).toBe(403);
});
