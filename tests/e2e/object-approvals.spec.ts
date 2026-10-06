import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V2-7: approvals on any object, behind `wos_object_approvals`.
 *
 * A project manager requests approval of a task from the record's approval
 * page; the request lands in the ordinary approval engine (an approval item
 * routed to an approver). A contributor on the project sees the status but
 * not the request form; someone outside the project sees the not-found page.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const NOT_FOUND = "Not found — or not yours to see";

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

function setSwitch(on: boolean) {
  sql(`update public.feature_flag set enabled = ${on} where key = any (array['wos_object_approvals']);`);
}

test.afterAll(() => setSwitch(false));

/**
 * A project the staff member manages (the volunteer contributes) and one task
 * in it. Returns the task id.
 */
function seedTask(stamp: number, taskTitle: string): string {
  const staff = `select u.id as user_id, m.organization_id
    from auth.users u join public.organization_membership m on m.user_id = u.id
    where u.email = 'qa-staff@example.com'`;
  const projectId = sql(`
    with who as (${staff})
    insert into public.project (organization_id, name, owner_id, created_by)
    select organization_id, 'Approvals ${stamp}', user_id, user_id from who
    returning id;
  `);
  sql(`
    with who as (${staff})
    insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
    select organization_id, '${projectId}'::uuid, user_id, 'project_manager'::public.project_access_role,
      'direct'::public.scoped_grant_source, user_id from who
    union all
    select who.organization_id, '${projectId}'::uuid, v.id, 'contributor'::public.project_access_role,
      'direct'::public.scoped_grant_source, who.user_id
    from who, auth.users v where v.email = 'qa-volunteer@example.com';
  `);
  const taskId = sql(`
    with who as (${staff})
    insert into public.task (organization_id, project_id, title, created_by)
    select organization_id, '${projectId}', '${taskTitle}', user_id from who
    returning id;
  `);
  return taskId;
}

test("a record's approval page is hidden while the switch is off [switch off]", async ({ page }) => {
  const stamp = Date.now();
  const taskId = seedTask(stamp, `Hidden banners ${stamp}`);
  setSwitch(false);
  await signIn(page, "staff");
  await page.goto(`/object-approvals/task/${taskId}`);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
});

test("a project manager sends a task for approval and readers follow its status", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const taskTitle = `Order the banners ${stamp}`;
  const taskId = seedTask(stamp, taskTitle);
  const url = `/object-approvals/task/${taskId}`;

  setSwitch(true);
  await signIn(page, "staff");
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: `Approval for ${taskTitle}` })).toBeVisible();
  await expect(page.getByText("No approval has been requested for this record.")).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);

  await page.getByLabel("Note for the approver (optional)").fill("Budget line 12");
  await page.getByRole("button", { name: "Request approval" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Approval requested." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Waiting for approval", { exact: true })).toBeVisible();
  await expect(page.getByText("This record is already waiting for approval.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Approvals" })).toBeVisible();

  // It is an ordinary approval item, routed by the engine.
  expect(
    sql(`select count(*) from public.approval_item i join public.object_approval oa on oa.approval_item_id = i.id
         where oa.object_id = '${taskId}' and i.subject_type = 'other' and i.status = 'pending'
           and exists (select 1 from public.approval_step s where s.item_id = i.id);`),
  ).toBe("1");

  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.reload();
  await expect(page.getByText("En attente d’approbation", { exact: true })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });

  // The engine's decision shows on the record (decided here directly, as the
  // approvers' own screens are covered by approvals.spec.ts).
  sql(`update public.approval_item i set status = 'approved', decided_at = now(), decided_by = i.requested_by
       from public.object_approval oa where oa.approval_item_id = i.id and oa.object_id = '${taskId}';`);

  // A contributor sees the status, not the request form.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(url);
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request approval" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open in Approvals" })).toHaveCount(0);
  expect(await axeProblems(page)).toEqual([]);

  // Someone outside the project sees nothing.
  await signOut(page);
  await signIn(page, "guest");
  await page.goto(url);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
});
