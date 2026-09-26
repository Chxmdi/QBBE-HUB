import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * General ledger (#148, #149): the owner records the accountant's approval,
 * opens the fiscal year, cannot post an unbalanced entry, posts a balanced
 * one, sees it on the trial balance and in the CSV, and corrects it with a
 * reversal. Staff see nothing until an admin names them a ledger reader, and
 * then only read. Posted entries are permanent by design, so each run uses a
 * unique memo rather than cleaning up.
 */
test("the owner posts a balanced entry, reports it and reverses it; staff only read with a grant", async ({ page }) => {
  test.setTimeout(240_000);
  const marker = `Ledger check ${Date.now()}`;
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${staffId}' limit 1`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);

  await signIn(page, "owner");
  await page.goto("/finance/ledger");
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();

  // Nothing posts before the accountant's approval is recorded.
  const approvalForm = page.getByLabel("Accountant who approved it");
  if (await approvalForm.isVisible()) {
    await approvalForm.fill("QA Accountant, CPA");
    await page.getByLabel("Approved on").fill("2026-09-20");
    await clickWhenInteractive(page.getByRole("button", { name: "Record approval" }));
    await expect(page.getByText(/Approved by QA Accountant, CPA on 2026-09-20/)).toBeVisible();
  }

  // The fiscal year that starts at the switchover.
  await page.goto("/finance/ledger/periods");
  if ((await page.getByRole("cell", { name: "2026-10", exact: true }).count()) === 0) {
    await page.getByLabel("First month of the fiscal year").fill("2026-10");
    await clickWhenInteractive(page.getByRole("button", { name: "Add fiscal year" }));
  }
  await expect(page.getByRole("cell", { name: "2026-10", exact: true })).toBeVisible();

  // An unbalanced entry cannot be posted; fixing the credit allows it.
  await page.goto("/finance/ledger/journal/new");
  await page.getByLabel("Date").fill("2026-10-02");
  await page.getByLabel("Memo").fill(marker);
  const line1 = page.getByRole("group", { name: "Line 1" });
  const line2 = page.getByRole("group", { name: "Line 2" });
  await line1.getByLabel("Account").selectOption({ label: "1000 Bank - chequing" });
  await line1.getByLabel("Debit").fill("250.00");
  await line2.getByLabel("Account").selectOption({ label: "4200 Donations" });
  await line2.getByLabel("Credit").fill("249.99");
  await expect(page.getByText("$0.01 more debits")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and post" })).toBeDisabled();
  await line2.getByLabel("Credit").fill("250.00");
  await clickWhenInteractive(page.getByRole("button", { name: "Save and post" }));

  await expect(page.getByRole("heading", { name: /^Entry \d+$/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Posted", { exact: true })).toBeVisible();
  const entryUrl = page.url();
  const entryNumber = (await page.getByRole("heading", { name: /^Entry \d+$/ }).textContent())?.replace("Entry ", "");

  // It is on the trial balance, which balances, and in the CSV.
  await page.goto("/finance/ledger/trial-balance?as_of=2026-10-31");
  await expect(page.getByRole("link", { name: "Bank - chequing" })).toBeVisible();
  const totals = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Total", exact: true }) });
  const cells = await totals.getByRole("cell").allTextContents();
  expect(cells[3], "total debits equal total credits").toBe(cells[4]);

  const csv = await page.request.get("/api/finance/ledger/trial-balance?as_of=2026-10-31");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const body = await csv.text();
  expect(body).toContain("Trial balance as at 2026-10-31");
  expect(body).toMatch(/1000,Bank - chequing,Asset,\d+\.\d{2},/);

  const gl = await page.request.get("/api/finance/ledger/general-ledger?from=2026-10-01&to=2026-10-31");
  expect(gl.status()).toBe(200);
  expect(await gl.text()).toContain(marker);

  // A posted entry is corrected by reversing it; the original stays.
  await page.goto(entryUrl);
  await clickWhenInteractive(page.getByRole("button", { name: "Reverse entry" }));
  const dialog = page.getByRole("dialog", { name: `Reverse entry ${entryNumber}` });
  await dialog.getByLabel("Date of the reversal").fill("2026-10-03");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Post reversal" }));
  await expect(page.getByRole("link", { name: "Reverses the original entry" })).toBeVisible({ timeout: 20_000 });
  await page.goto(entryUrl);
  await expect(page.getByRole("link", { name: /^Reversed by entry \d+$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reverse entry" })).toHaveCount(0);
  await signOut(page);

  // Staff see nothing until an admin names them a reader, and then only read.
  try {
    await signIn(page, "staff");
    await page.goto("/finance/ledger/journal");
    await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
    expect((await page.request.get("/api/finance/ledger/trial-balance")).status()).toBe(403);

    sql(`insert into ledger_reader (organization_id, user_id) values ('${orgId}', '${staffId}')`);
    await page.goto("/finance/ledger/journal");
    await expect(page.getByRole("link", { name: marker, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New entry" })).toHaveCount(0);
    await page.goto(entryUrl);
    await expect(page.getByRole("button", { name: "Reverse entry" })).toHaveCount(0);
  } finally {
    sql(`delete from ledger_reader where user_id = '${staffId}'`);
  }
});
