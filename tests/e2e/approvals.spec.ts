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
