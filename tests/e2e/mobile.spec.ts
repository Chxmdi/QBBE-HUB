import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-16: phone screens at 390px, behind `wos_mobile`.
 *
 * A staff member captures a task, sees it on Today, ticks it off, finds a
 * project in search, reads a notification, and approves an item, all at
 * phone width with no sideways scrolling. The web app manifest and icons are
 * served without a session, so the browser can offer "Install".
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

/** The page fits the phone: nothing scrolls sideways. */
async function fitsWidth(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

function setSwitch(on: boolean) {
  sql(`update public.feature_flag set enabled = ${on} where key = any (array['wos_mobile']);`);
}

test.afterAll(() => setSwitch(false));

test("the web app manifest and icons load without signing in", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  const body = (await manifest.json()) as { name: string; icons: { src: string }[] };
  expect(body.name).toBe("QBBE Hub");
  for (const icon of body.icons) {
    const response = await request.get(icon.src, { maxRedirects: 0 });
    expect(response.status(), icon.src).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
});

test("a staff member works through the phone screens at 390px", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const stamp = Date.now();
  const projectName = `Phone project ${stamp}`;
  const who = `select u.id as user_id, m.organization_id
    from auth.users u join public.organization_membership m on m.user_id = u.id
    where u.email = 'qa-staff@example.com'`;
  const projectId = sql(`
    with who as (${who})
    insert into public.project (organization_id, name, owner_id, created_by, stage)
    select organization_id, '${projectName}', user_id, user_id, 'planning' from who
    returning id;
  `);
  sql(`
    with who as (${who})
    insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
    select organization_id, '${projectId}', user_id, 'project_manager'::public.project_access_role,
      'direct'::public.scoped_grant_source, user_id from who;
  `);
  sql(`
    with who as (${who})
    insert into public.notification (user_id, organization_id, category, title, body, dedupe_key)
    select user_id, organization_id, 'mention', 'Phone note ${stamp}', 'Read me on the bus', 'phone-${stamp}' from who;
  `);
  // An item waiting for the staff member's approval, requested by the admin.
  sql(`
    with who as (${who}), item as (
      insert into public.approval_item (organization_id, subject_type, title, requested_by, current_step)
      select who.organization_id, 'other', 'Phone approval ${stamp}', a.id, 1
      from who, auth.users a where a.email = 'qa-admin@example.com'
      returning id, organization_id
    )
    insert into public.approval_step (item_id, organization_id, step, label, approver_kind, approver_id)
    select item.id, item.organization_id, 1, 'Staff', 'person', who.user_id from item, who;
  `);

  setSwitch(false);
  await signIn(page, "staff");
  await page.goto("/m/today");
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();

  setSwitch(true);

  // Capture.
  await page.goto("/m/capture");
  await expect(page.getByRole("heading", { level: 1, name: "Capture" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);
  const title = `Buy chairs ${stamp}`;
  const today = sql(`select to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD');`);
  await page.getByLabel("What needs doing").fill(title);
  await page.getByLabel("Project", { exact: true }).selectOption({ label: projectName });
  await page.getByLabel("Due (optional)").fill(today);
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added to your tasks." })).toBeVisible({ timeout: 30_000 });

  // Today, reached from the tab bar with the keyboard.
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  await nav.getByRole("link", { name: "Today" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/m\/today$/);
  await expect(page.getByText(title)).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);
  await page.getByRole("button", { name: `Mark “${title}” done` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked done." })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select status from public.task where title = '${title}';`)).toBe("completed");

  // Tasks.
  await nav.getByRole("link", { name: "Tasks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My tasks" })).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);

  // Inbox.
  await nav.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByText(`Phone note ${stamp}`)).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);

  // Search.
  await nav.getByRole("link", { name: "Search" }).click();
  await page.getByLabel("Search the workspace").fill(projectName);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(projectName) })).toBeVisible({ timeout: 30_000 });
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);

  // Approvals.
  await nav.getByRole("link", { name: "Approvals" }).click();
  await expect(page.getByText(`Phone approval ${stamp}`)).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);
  await page.getByRole("button", { name: `Approve “Phone approval ${stamp}”` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved." })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select status from public.approval_item where title = 'Phone approval ${stamp}';`)).toBe("approved");

  // French.
  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.goto("/m/today");
  await expect(page.getByRole("heading", { level: 1, name: "Aujourd’hui" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navigation mobile" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  expect(await fitsWidth(page)).toBe(true);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
