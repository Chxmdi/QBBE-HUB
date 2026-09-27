import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Approvals (#143): a purchase over $5,000 needs the executive director and
 * then the treasurer, two different people; a contract with no matching rule
 * goes to the administrators, and a rejection carries its reason back to the
 * requester. Who may do what is proven in supabase/tests/approvals.sql; these
 * prove the screens drive it.
 */

const ownerId = () => sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
const adminId = () => sql(`select id::text from user_profile where email = 'qa-admin@example.com'`);
const orgId = () =>
  sql(`select organization_id::text from organization_membership where user_id = '${ownerId()}' limit 1`);

async function requestApproval(page: Page, kind: string, title: string, amount?: string) {
  await page.goto("/approvals");
  await page.getByRole("button", { name: "Request approval" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What needs approval").selectOption({ label: kind });
  if (amount) await dialog.getByLabel(/^Amount/).fill(amount);
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Submit for approval" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("link", { name: /My requests/ }).click();
  await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("Waiting");
}

async function decide(page: Page, title: string, decision: "Approve" | "Reject", note?: string) {
  await page.goto("/approvals");
  const row = page.getByRole("list", { name: "Approvals" }).getByRole("link", { name: new RegExp(title) });
  await expect(row).toBeVisible();
  await row.click();
  const details = page.getByRole("region", { name: "Approval details" });
  await expect(details.getByRole("heading", { name: title })).toBeVisible();
  if (note) await details.getByLabel(/Comment or reason/).fill(note);
  await details.getByRole("button", { name: decision, exact: true }).click();
  await expect(page.getByText(decision === "Approve" ? "Approved." : "Rejected.")).toBeVisible();
}

test("a purchase over $5,000 needs the director and then the treasurer", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `Laptop ${Date.now()}`;
  sql(`insert into approval_rule (organization_id, subject_type, min_amount_cents, step, approver_kind, approver_user_id, label)
       values ('${orgId()}', 'purchase', 500000, 1, 'person', '${ownerId()}', 'E2E executive director'),
              ('${orgId()}', 'purchase', 500000, 2, 'person', '${adminId()}', 'E2E treasurer')`);
  try {
    await signIn(page, "staff");
    await requestApproval(page, "Purchase request", title, "6,000.00");
    await signOut(page);

    // Step 2 is not the treasurer's to decide until step 1 is done.
    await signIn(page, "admin");
    await page.goto("/approvals");
    await expect(page.getByRole("list", { name: "Approvals" }).getByRole("link", { name: new RegExp(title) })).toHaveCount(0);
    await signOut(page);

    await signIn(page, "owner");
    await decide(page, title, "Approve");
    const steps = page.getByRole("list", { name: "Approvers" });
    await expect(steps.getByRole("listitem").filter({ hasText: "E2E executive director" })).toContainText("Approved");
    await signOut(page);

    await signIn(page, "admin");
    await decide(page, title, "Approve", "Within budget");
    await expect(page.getByRole("region", { name: "Approval details" }).getByText("Approved", { exact: true }).first()).toBeVisible();
    await signOut(page);

    await signIn(page, "staff");
    await page.goto("/approvals?tab=mine");
    await expect(page.getByRole("link", { name: new RegExp(title) })).toContainText("Approved");
  } finally {
    sql(`delete from notification where source_type = 'approval_item' and title like '%${title}'`);
    sql(`delete from approval_item where title = '${title}'`);
    sql(`delete from approval_rule where label in ('E2E executive director', 'E2E treasurer')`);
  }
});

test("a rejected contract goes back to the requester with the reason", async ({ page }) => {
  test.setTimeout(120_000);
  const title = `Caterer contract ${Date.now()}`;
  try {
    await signIn(page, "staff");
    await requestApproval(page, "Contract", title);
    await signOut(page);

    await signIn(page, "admin");
    await decide(page, title, "Reject", "Get a second quote first");
    await signOut(page);

    await signIn(page, "staff");
    await page.goto("/approvals?tab=mine");
    const row = page.getByRole("link", { name: new RegExp(title) });
    await expect(row).toContainText("Rejected");
    await row.click();
    const details = page.getByRole("region", { name: "Approval details" });
    await expect(details.getByText("Get a second quote first").first()).toBeVisible();
    // The requester is told in the notification inbox as well.
    await expect.poll(() =>
      sql(`select count(*) from notification n join user_profile u on u.id = n.user_id
           where u.email = 'qa-staff@example.com' and n.title = 'Rejected: ${title}'`),
    ).toBe("1");
  } finally {
    sql(`delete from notification where source_type = 'approval_item' and title like '%${title}'`);
    sql(`delete from approval_item where title = '${title}'`);
  }
});

/**
 * The hand-off to the ledger (#143, #150): a bill over the approval threshold
 * cannot be posted until it is sent for approval and approved; the approver
 * can open the bill from the approval; the owner is told it is ready and
 * posts it. What counts as the bill's approval is proven in
 * supabase/tests/bill-approval-handoff.sql. Posted bills are permanent, so
 * each run uses a unique vendor.
 */
test("a bill over the threshold is approved, then posted to the ledger", async ({ page }) => {
  test.setTimeout(240_000);
  const run = Date.now();
  const vendor = `QA Handoff Vendor ${run}`;
  const reference = `H-${run}`;
  const title = `Bill from ${vendor} #${reference}`;
  const org = orgId();
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);

  // Open books (as payables.spec.ts does), a $1,000 threshold, and a $1,500 draft bill.
  sql(`update ledger_settings set chart_approved_on = '2026-09-20', chart_approved_by_name = 'QA Accountant, CPA',
         chart_approval_recorded_at = now()
       where organization_id = '${org}' and chart_approved_on is null`);
  sql(`insert into ledger_period (organization_id, name, starts_on, ends_on)
       select '${org}', to_char(m, 'YYYY-MM'), m, (m + interval '1 month' - interval '1 day')::date
       from generate_series(date '2026-10-01', date '2027-09-01', interval '1 month') as g(m)
       where not exists (select 1 from ledger_period p where p.organization_id = '${org}'
                         and p.starts_on <= (g.m + interval '1 month' - interval '1 day')::date and g.m <= p.ends_on)`);
  const previousThreshold = sql(
    `select coalesce(bill_approval_threshold_cents::text, 'null') from finance_billing_settings where organization_id = '${org}'`,
  ) || "null";
  sql(`insert into finance_billing_settings (organization_id, bill_approval_threshold_cents)
       values ('${org}', 100000)
       on conflict (organization_id) do update set bill_approval_threshold_cents = 100000`);
  const vendorId = sql(`insert into finance_contact (organization_id, name, is_vendor, created_by)
       values ('${org}', '${vendor}', true, '${staffId}') returning id::text`);
  const billId = sql(`insert into finance_bill (organization_id, vendor_id, vendor_reference, bill_date, due_date,
         fund_id, subtotal_cents, created_by)
       select '${org}', '${vendorId}', '${reference}', '2026-10-06', '2026-11-05', f.id, 150000, '${staffId}'
       from ledger_fund f where f.organization_id = '${org}' and f.code = 'GEN'
       returning id::text`);
  sql(`insert into finance_bill_line (organization_id, bill_id, line_no, account_id, description, amount_cents)
       select '${org}', '${billId}', 1, a.id, 'Workshop venue', 150000
       from ledger_account a where a.organization_id = '${org}' and a.code = '5200'`);
  const billUrl = `/finance/payables/bills/${billId}`;

  try {
    // Staff send it for approval.
    await signIn(page, "staff");
    await page.goto(billUrl);
    await expect(page.getByText("Send it for approval; it can be posted once approved.")).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText("It is waiting for approval.")).toBeVisible({ timeout: 20_000 });
    await signOut(page);

    // The admin cannot post it yet, opens it from the approval, and approves.
    await signIn(page, "admin");
    await page.goto(billUrl);
    await expect(page.getByText("It is waiting for approval.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post bill" })).toHaveCount(0);
    await page.goto("/approvals");
    const row = page.getByRole("list", { name: "Approvals" }).getByRole("link", { name: new RegExp(title) });
    await expect(row).toBeVisible();
    await row.click();
    const details = page.getByRole("region", { name: "Approval details" });
    await expect(details.getByRole("link", { name: "Open the vendor bill" })).toHaveAttribute("href", billUrl);
    await details.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await signOut(page);

    // The owner is told it is ready, and posts it.
    await expect
      .poll(() =>
        sql(`select count(*) from notification where user_id = '${ownerId()}'
             and source_id = '${billId}' and title like 'Ready to post:%'`),
      )
      .toBe("1");
    await signIn(page, "owner");
    await page.goto(billUrl);
    await expect(page.getByText("It is approved and ready to post.")).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Post bill" }).click();
    await expect(page.getByRole("link", { name: "Posted entry" })).toBeVisible({ timeout: 20_000 });
    expect(sql(`select status from finance_bill where id = '${billId}'`)).toBe("posted");
  } finally {
    sql(`update finance_billing_settings set bill_approval_threshold_cents = ${previousThreshold}
         where organization_id = '${org}'`);
  }
});
