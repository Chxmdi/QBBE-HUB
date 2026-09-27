import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * GST/QST (#152): the owner adds a tax period, records a sale and a purchase,
 * reads the return worksheet, drills from a return line to its lines, exports
 * the CSV, sees the rebate estimate only once it is switched on, closes the
 * period (posting the net tax to the ledger) and reopens it (reversing that
 * entry). Staff without ledger access see nothing. The period lives in
 * 2027-06 so it cannot collide with the ledger spec; posted journal entries
 * are permanent by design, so each run uses a unique counterparty.
 */
const FROM = "2027-06-01";
const TO = "2027-06-30";

function resetPeriod(orgId: string) {
  // A run that failed after closing leaves the period closed; open it as the
  // table owner so it can be removed. Its closing entry stays in the ledger.
  sql(`update sales_tax_period set status = 'open', gst_collected_cents = null, gst_claimed_cents = null,
         qst_collected_cents = null, qst_claimed_cents = null, closing_entry_id = null,
         closed_by = null, closed_at = null
       where organization_id = '${orgId}' and starts_on = '${FROM}'`);
  sql(`delete from sales_tax_line where organization_id = '${orgId}' and transaction_date between '${FROM}' and '${TO}'`);
  sql(`delete from sales_tax_period where organization_id = '${orgId}' and starts_on = '${FROM}'`);
}

test("the owner records tax, reads the worksheet, closes and reopens the period; staff see nothing", async ({ page }) => {
  test.setTimeout(240_000);
  const marker = `Tax check ${Date.now()}`;
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${staffId}' limit 1`);
  sql(`delete from ledger_reader where user_id = '${staffId}'`);
  resetPeriod(orgId);
  // The ledger must accept the closing entry: an approved chart and open
  // periods for June (closing) and July (the reversal).
  sql(`update ledger_settings set chart_approved_on = '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now()
       where organization_id = '${orgId}' and chart_approved_on is null`);
  for (const [start, end] of [["2027-06-01", "2027-06-30"], ["2027-07-01", "2027-07-31"]]) {
    sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
         select '${orgId}', '${start.slice(0, 7)}', '${start}', '${end}'
         where not exists (select 1 from ledger_period where organization_id = '${orgId}' and starts_on = '${start}')`);
    sql(`update ledger_period set status = 'open', closed_at = null, closed_by = null
         where organization_id = '${orgId}' and starts_on = '${start}'`);
  }
  sql(`update sales_tax_settings set gst_registered = true, qst_registered = true, itc_claim_bp = 10000,
         show_psb_rebate = false where organization_id = '${orgId}'`);
  page.on("dialog", (dialog) => void dialog.accept());

  try {
    await signIn(page, "owner");
    await page.goto("/finance/sales-tax");
    await expect(page.getByRole("heading", { name: "GST and QST", exact: true })).toBeVisible();
    await expect(page.getByLabel("Registered for GST")).toBeChecked();

    await page.getByLabel("Period starts").fill(FROM);
    await page.getByLabel("Period ends").fill(TO);
    await clickWhenInteractive(page.getByRole("button", { name: "Add tax period" }));
    await expect(page.getByRole("cell", { name: `${FROM} to ${TO}`, exact: true })).toBeVisible();

    // A standard-rated sale: tax is calculated by the database.
    await page.goto(`/finance/sales-tax/lines?from=${FROM}&to=${TO}`);
    await clickWhenInteractive(page.getByRole("button", { name: "Add tax line" }));
    let dialog = page.getByRole("dialog", { name: "Add a tax line" });
    await dialog.getByLabel("Date").fill("2027-06-10");
    await dialog.getByLabel("Customer").fill(`${marker} customer`);
    await dialog.getByLabel("Amount before tax").fill("100.00");
    await clickWhenInteractive(dialog.getByRole("button", { name: "Save tax line" }));
    const saleRow = page.getByRole("row").filter({ hasText: `${marker} customer` });
    await expect(saleRow.getByRole("cell", { name: "$5.00", exact: true })).toBeVisible();
    await expect(saleRow.getByRole("cell", { name: "$9.98", exact: true })).toBeVisible();

    // A purchase: tax paid as invoiced, claimed back in full by default.
    await clickWhenInteractive(page.getByRole("button", { name: "Add tax line" }));
    dialog = page.getByRole("dialog", { name: "Add a tax line" });
    await dialog.getByLabel("Sale or purchase").selectOption("purchase");
    await dialog.getByLabel("Date").fill("2027-06-12");
    await dialog.getByLabel("Supplier").fill(`${marker} supplier`);
    await dialog.getByLabel("Amount before tax").fill("200.00");
    await dialog.getByLabel("GST paid").fill("10.00");
    await dialog.getByLabel("QST paid").fill("19.95");
    await clickWhenInteractive(dialog.getByRole("button", { name: "Save tax line" }));
    const purchaseRow = page.getByRole("row").filter({ hasText: `${marker} supplier` });
    await expect(purchaseRow.getByRole("cell", { name: "$19.95", exact: true })).toHaveCount(2);

    // The worksheet: GST net 5.00 - 10.00, QST net 9.98 - 19.95.
    await page.goto("/finance/sales-tax");
    await page.getByRole("link", { name: `Worksheet for ${FROM} to ${TO}` }).click();
    await expect(page.getByRole("heading", { name: "Return worksheet" })).toBeVisible();
    const gst = page.getByRole("region", { name: "GST (federal lines)" });
    const qst = page.getByRole("region", { name: "QST (Quebec lines)" });
    await expect(gst.getByRole("row").filter({ hasText: /^103/ })).toContainText("$5.00");
    await expect(gst.getByRole("row").filter({ hasText: /^106/ })).toContainText("$10.00");
    await expect(gst.getByRole("row").filter({ hasText: /^109/ })).toContainText("-$5.00");
    await expect(qst.getByRole("row").filter({ hasText: /^209/ })).toContainText("-$9.97");
    await expect(page.getByText(/confirm eligibility with your accountant/i)).toHaveCount(0);

    // Drill down from line 103 to the sale behind it.
    await gst.getByRole("link", { name: /show the lines behind line 103/ }).click();
    await expect(page.getByRole("heading", { name: "Tax lines" })).toBeVisible();
    await expect(page.getByText(`${marker} customer`)).toBeVisible();
    await expect(page.getByText(`${marker} supplier`)).toHaveCount(0);

    const csv = await page.request.get(`/api/finance/sales-tax/worksheet?from=${FROM}&to=${TO}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain("GST,109,Net tax");
    expect(body).toContain(`${marker} supplier`);

    // The rebate estimate appears only once switched on, clearly labelled.
    sql(`update sales_tax_settings set show_psb_rebate = true where organization_id = '${orgId}'`);
    await page.goto(`/finance/sales-tax/worksheet?from=${FROM}&to=${TO}`);
    await expect(
      page.getByRole("heading", { name: "Public service body rebate: confirm eligibility with your accountant" }),
    ).toBeVisible();

    // Close: one posted entry, frozen lines.
    await page.goto("/finance/sales-tax");
    await page.getByRole("link", { name: `Worksheet for ${FROM} to ${TO}` }).click();
    await clickWhenInteractive(page.getByRole("button", { name: "Close period and post net tax" }));
    await expect(page.getByRole("link", { name: "View the closing entry" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "View the closing entry" }).click();
    await expect(page.getByRole("heading", { name: /^Entry \d+$/ })).toBeVisible();
    await expect(page.getByText("Posted", { exact: true })).toBeVisible();
    await page.goto(`/finance/sales-tax/lines?from=${FROM}&to=${TO}`);
    await expect(page.getByText("Period closed").first()).toBeVisible();

    // Reopen: the closing entry is reversed and the period is open again.
    await page.goto("/finance/sales-tax");
    await page.getByRole("link", { name: `Worksheet for ${FROM} to ${TO}` }).click();
    await clickWhenInteractive(page.getByRole("button", { name: "Reopen period" }));
    const reopen = page.getByRole("dialog", { name: `Reopen ${FROM} to ${TO}` });
    await reopen.getByLabel("Date of the reversing entry").fill("2027-07-02");
    await clickWhenInteractive(reopen.getByRole("button", { name: "Reopen and reverse" }));
    await expect(page.getByRole("button", { name: "Close period and post net tax" })).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    // Staff who are not ledger readers see nothing.
    await signIn(page, "staff");
    await page.goto("/finance/sales-tax/worksheet");
    await expect(page.getByText("You do not have access to the ledger")).toBeVisible();
    expect((await page.request.get(`/api/finance/sales-tax/worksheet?from=${FROM}&to=${TO}`)).status()).toBe(403);
  } finally {
    sql(`update sales_tax_settings set show_psb_rebate = false where organization_id = '${orgId}'`);
    resetPeriod(orgId);
  }
});
