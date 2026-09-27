import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Away cover (#143): the owner, who approves purchases, names the program
 * lead as their delegate for a few days; the lead then approves a purchase
 * waiting on the owner, and the trail says it was on the owner's behalf; the
 * owner ends the delegation early. Who may do what (no self-approval, no
 * chains, the automatic end) is proven in supabase/tests/approval-delegation.sql;
 * this proves the screens drive it.
 */

const ownerId = () => sql(`select id::text from user_profile where email = 'qa-owner@example.com'`);
const leadId = () => sql(`select id::text from user_profile where email = 'qa-lead@example.com'`);
const orgId = () =>
  sql(`select organization_id::text from organization_membership where user_id = '${ownerId()}' limit 1`);

/** A calendar date in the organization's zone, as a date input takes it. */
function dayInToronto(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(date);
}

test("a delegate approves for an approver who is away, on their behalf", async ({ page }) => {
  test.setTimeout(240_000);
  const title = `Projector ${Date.now()}`;
  const label = `E2E away approver ${Date.now()}`;
  const org = orgId();
  sql(`insert into approval_rule (organization_id, subject_type, step, approver_kind, approver_user_id, label)
       values ('${org}', 'purchase', 1, 'person', '${ownerId()}', '${label}')`);
  // Start clean in case an earlier run stopped halfway.
  sql(`delete from approval_delegation where approver_id = '${ownerId()}'`);
  try {
    // The owner sets the lead as their delegate, starting today.
    await signIn(page, "owner");
    await page.goto("/approvals?tab=away");
    await page.getByRole("button", { name: "Set a delegate" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Delegate", { exact: true }).selectOption({ label: "QA Program Lead" });
    await dialog.getByLabel("First day").fill(dayInToronto(0));
    await dialog.getByLabel("Last day").fill(dayInToronto(3));
    await dialog.getByLabel("Note").fill("Conference");
    await dialog.getByRole("button", { name: "Save delegate" }).click();
    await expect(dialog).toBeHidden();
    const delegations = page.getByRole("list", { name: "Delegations" });
    const row = delegations.getByRole("listitem").filter({ hasText: "QA Program Lead decides for QA Owner" });
    await expect(row).toContainText("Active");
    await signOut(page);

    // Staff request a purchase; it waits on the owner.
    await signIn(page, "staff");
    await page.goto("/approvals");
    await page.getByRole("button", { name: "Request approval" }).click();
    const request = page.getByRole("dialog");
    await request.getByLabel("What needs approval").selectOption({ label: "Purchase request" });
    await request.getByLabel(/^Amount/).fill("850.00");
    await request.getByLabel("Title", { exact: true }).fill(title);
    await request.getByRole("button", { name: "Submit for approval" }).click();
    await expect(request).toBeHidden();
    await signOut(page);

    // The lead is told, finds it waiting on them, and approves it.
    await expect
      .poll(() =>
        sql(`select count(*) from notification where user_id = '${leadId()}'
             and source_type = 'approval_item' and title = 'Approval needed: ${title}'`),
      )
      .toBe("1");
    await signIn(page, "lead");
    await page.goto("/approvals");
    const item = page.getByRole("list", { name: "Approvals" }).getByRole("link", { name: new RegExp(title) });
    await expect(item).toBeVisible();
    await item.click();
    const details = page.getByRole("region", { name: "Approval details" });
    await expect(details.getByRole("heading", { name: title })).toBeVisible();
    await details.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved.")).toBeVisible();
    await expect(
      details.getByRole("list", { name: "Approval trail" }).getByRole("listitem").filter({ hasText: /^Approved by/ }),
    ).toContainText("QA Program Lead on behalf of QA Owner");
    await expect(
      details.getByRole("list", { name: "Approvers" }).getByRole("listitem").filter({ hasText: label }),
    ).toContainText("on behalf of QA Owner");
    // The lead cannot end someone else's delegation.
    await page.goto("/approvals?tab=away");
    await expect(
      page.getByRole("list", { name: "Delegations" }).getByRole("button", { name: "End now" }),
    ).toHaveCount(0);
    await signOut(page);

    // The owner comes back early and ends it.
    await signIn(page, "owner");
    await page.goto("/approvals?tab=away");
    await page
      .getByRole("list", { name: "Delegations" })
      .getByRole("listitem")
      .filter({ hasText: "QA Program Lead decides for QA Owner" })
      .getByRole("button", { name: "End now" })
      .click();
    await expect(page.getByText("Delegation ended.")).toBeVisible();
    await expect(page.getByText("No one is covering")).toBeVisible();
    expect(
      sql(`select count(*) from audit_event where object_type = 'approval_delegation'
           and action in ('delegation_set', 'delegation_ended') and metadata->>'approver_id' = '${ownerId()}'
           and created_at > now() - interval '1 hour'`),
    ).not.toBe("0");
  } finally {
    sql(`delete from notification where source_type = 'approval_item' and title like '%${title}'`);
    sql(`delete from approval_item where title = '${title}'`);
    sql(`delete from approval_rule where label = '${label}'`);
    sql(`delete from approval_delegation where approver_id = '${ownerId()}'`);
  }
});
