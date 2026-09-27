import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";
import { clickWhenInteractive } from "./interactive";

/**
 * Payables and receivables (#150): staff add a vendor and draft a bill but
 * cannot post it; the owner posts it, pays it in two parts and cannot pay it
 * again; the aging and its CSV follow; an invoice is posted, numbered and
 * shown in the customer's language. Posted records are permanent, so each run
 * uses unique names rather than cleaning up.
 */
test("staff draft a bill, the owner posts and pays it once, aging follows, an invoice is issued", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  const vendor = `QA Vendor ${run}`;
  const customer = `QA Funder ${run}`;
  const ownerId = sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
  const orgId = sql(`select organization_id::text from organization_membership where user_id = '${ownerId}' limit 1`);

  // The books are open: chart approved and fiscal year 2026-10 present.
  sql(`update ledger_settings set chart_approved_on = '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now()
       where organization_id = '${orgId}' and chart_approved_on is null`);
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${orgId}', to_char(m, 'YYYY-MM'), m, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2026-10-01', date '2027-09-01', interval '1 month') as g(m)
       where not exists (select 1 from ledger_period p where p.organization_id = '${orgId}'
                         and p.starts_on <= (g.m + interval '1 month' - interval '1 day')::date and g.m <= p.ends_on)`);

  // Staff: a vendor, then a draft bill they cannot post.
  await signIn(page, "staff");
  await page.goto("/finance/payables/contacts");
  await clickWhenInteractive(page.getByRole("button", { name: "Add contact" }));
  let dialog = page.getByRole("dialog", { name: "Add a vendor or customer" });
  await dialog.getByLabel("Name").fill(vendor);
  await clickWhenInteractive(dialog.getByRole("button", { name: "Save" }));
  await expect(page.getByRole("cell", { name: vendor, exact: true })).toBeVisible();

  await page.goto("/finance/payables/bills/new");
  await page.getByLabel("Vendor", { exact: true }).selectOption({ label: vendor });
  await page.getByLabel("Vendor invoice number").fill(`F-${run}`);
  await page.getByLabel("Bill date").fill("2026-10-05");
  await page.getByLabel("Due date").fill("2026-11-04");
  const line = page.getByRole("group", { name: "Line 1" });
  await line.getByLabel("Description (optional)").fill("Paper and toner");
  await line.getByLabel("Expense or asset account").selectOption({ label: "5300 Office supplies" });
  await line.getByLabel("Amount before tax").fill("200.00");
  await page.getByLabel("GST", { exact: true }).fill("10.00");
  await page.getByLabel("QST", { exact: true }).fill("19.95");
  await expect(page.getByText("$229.95")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save and post bill" })).toHaveCount(0);
  await clickWhenInteractive(page.getByRole("button", { name: "Save draft" }));
  await expect(page.getByRole("heading", { name: `Bill from ${vendor} #F-${run}` })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("header").getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Post bill" })).toHaveCount(0);
  const billUrl = page.url();
  await signOut(page);

  // Owner: post, pay in two parts, then no further payment is possible.
  await signIn(page, "owner");
  await page.goto(billUrl);
  page.once("dialog", (d) => void d.accept());
  await clickWhenInteractive(page.getByRole("button", { name: "Post bill" }));
  await expect(page.locator("header").getByText("Open", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Posted entry" })).toBeVisible();

  await clickWhenInteractive(page.getByRole("button", { name: "Record a payment" }));
  dialog = page.getByRole("dialog", { name: "Record a payment" });
  await dialog.getByLabel("Amount").fill("300.00");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Record payment" }));
  await expect(dialog.getByRole("alert")).toContainText("more than the bill still owing");
  await dialog.getByLabel("Amount").fill("100.00");
  await dialog.getByLabel("Date").fill("2026-10-20");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Record payment" }));
  await expect(page.getByRole("cell", { name: "$100.00" })).toBeVisible({ timeout: 20_000 });

  // Aging on 2026-10-25 shows what is left; the ledger agrees.
  await page.goto("/finance/payables/aging?kind=bill&as_of=2026-10-25");
  const agingRow = page.getByRole("row").filter({ has: page.getByRole("link", { name: vendor }) });
  await expect(agingRow).toContainText("$129.95");
  await expect(page.getByTestId("aging-ledger-check")).toContainText("It matches the aging total.");
  const csv = await page.request.get("/api/finance/aging?kind=bill&as_of=2026-10-25");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(`${vendor},F-${run},2026-10-05,2026-11-04,0,Not yet due,229.95,129.95`);

  await page.goto(billUrl);
  await clickWhenInteractive(page.getByRole("button", { name: "Record a payment" }));
  dialog = page.getByRole("dialog", { name: "Record a payment" });
  await expect(dialog.getByLabel("Amount")).toHaveValue("129.95");
  await dialog.getByLabel("Date").fill("2026-11-01");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Record payment" }));
  await expect(page.locator("header").getByText("Paid", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Record a payment" })).toHaveCount(0);

  // Receivables: a customer invoiced in English, posted and numbered.
  await page.goto("/finance/payables/contacts");
  await clickWhenInteractive(page.getByRole("button", { name: "Add contact" }));
  dialog = page.getByRole("dialog", { name: "Add a vendor or customer" });
  await dialog.getByLabel("Name").fill(customer);
  await dialog.getByLabel("A vendor (sends us bills)").uncheck();
  await dialog.getByLabel("A customer or funder (we invoice them)").check();
  await dialog.getByLabel("Invoice language").selectOption("en");
  await clickWhenInteractive(dialog.getByRole("button", { name: "Save" }));
  await expect(page.getByRole("cell", { name: customer, exact: true })).toBeVisible();

  await page.goto("/finance/payables/invoices/new");
  await page.getByLabel("Customer or funder").selectOption({ label: customer });
  await page.getByLabel("Invoice date").fill("2026-10-10");
  await page.getByLabel("Due date").fill("2026-11-09");
  const invLine = page.getByRole("group", { name: "Line 1" });
  await invLine.getByLabel("Description", { exact: true }).fill("Grant installment 1");
  await invLine.getByLabel("Revenue account").selectOption({ label: "4100 Foundation and corporate grants" });
  await invLine.getByLabel("Amount before tax").fill("1500.00");
  await clickWhenInteractive(page.getByRole("button", { name: "Save and post invoice" }));
  await expect(page.getByRole("heading", { name: new RegExp(`^INV-\\d{4} to ${customer}$`) })).toBeVisible({ timeout: 20_000 });
  const sheet = page.getByRole("article", { name: "Invoice" });
  await expect(sheet).toContainText("Bill to");
  await expect(sheet).toContainText("Grant installment 1");
  await expect(sheet).toContainText("$1,500.00");
  await signOut(page);
});
