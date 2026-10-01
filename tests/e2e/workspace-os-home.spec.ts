import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Home and My World (M17a, M17b, epic #199), behind the wos_home switch,
 * which this spec turns on for its own run and back off afterwards.
 */

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

test.beforeAll(() => {
  sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
});
test.afterAll(() => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
});

test("Home shows my urgent work, what I wait on, and My World gathers it; nobody else sees it", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}'`);
  const overdue = `Overdue for Home ${suffix}`;
  const asked = `Asked of the volunteer ${suffix}`;
  sql(`insert into task (organization_id, title, created_by, requester_id, assignee_id, due_at)
       values ('${org}', '${overdue}', '${OWNER_ID}', '${OWNER_ID}', '${OWNER_ID}', (now() at time zone 'America/Toronto')::date - 3),
              ('${org}', '${asked}', '${OWNER_ID}', '${OWNER_ID}', '${VOLUNTEER_ID}', (now() at time zone 'America/Toronto')::date + 2)`);

  await signIn(page, "owner");
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  const now = page.getByRole("region", { name: /^Now/ });
  await expect(now.getByRole("link", { name: overdue })).toBeVisible();
  await expect(now.getByText(/Overdue since/).first()).toBeVisible();
  // The attention explanation (M17c): the rules that put it there, in words.
  const item = now.getByRole("listitem").filter({ hasText: overdue });
  await expect(item.getByText("Overdue by 3 days; Assigned to you")).toBeVisible();
  const waiting = page.getByRole("region", { name: /^Waiting/ });
  await expect(waiting.getByRole("link", { name: asked })).toBeVisible();
  for (const name of ["Today", "Continue", "Decisions", "Changes"]) {
    await expect(page.getByRole("region", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  expect(await axeProblems(page), "Home accessibility").toEqual([]);

  // Keyboard: the view tabs and the first item link are reachable by Tab.
  await page.getByRole("link", { name: "My World" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/home\/world$/);
  await expect(page.getByRole("region", { name: /^My tasks/ }).getByRole("link", { name: overdue })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Waiting on/ }).getByRole("link", { name: asked })).toBeVisible();
  for (const name of ["Meetings", "Projects", "Mentions", "Decisions needed"]) {
    await expect(page.getByRole("region", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  expect(await axeProblems(page), "My World accessibility").toEqual([]);

  // The item opens the task.
  await page.getByRole("region", { name: /^My tasks/ }).getByRole("link", { name: overdue }).click();
  await expect(page).toHaveURL(/\/my-work\?task=/);

  // Another person's Home does not show the owner's own task.
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: overdue })).toHaveCount(0);
  // The task asked of the volunteer is theirs: due in two days, it is in Now.
  const theirNow = page.getByRole("region", { name: /^Now/ }).getByRole("listitem").filter({ hasText: asked });
  await expect(theirNow.getByText("Due in 2 days; Assigned to you")).toBeVisible();
  await page.goto("/home/world");
  await expect(page.getByRole("region", { name: /^My tasks/ }).getByRole("link", { name: asked })).toBeVisible();
});

test("While you were away lists others' changes to my work since my last visit, ranked", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}'`);
  const staff = sql(`select id from user_profile where full_name = 'QA Staff'`);
  const blocked = `Blocked while away ${suffix}`;
  const moved = `Moved while away ${suffix}`;
  const [blockedId, movedId] = sql(
    `insert into task (organization_id, title, created_by, requester_id, assignee_id)
     values ('${org}', '${blocked}', '${OWNER_ID}', '${OWNER_ID}', '${OWNER_ID}'),
            ('${org}', '${moved}', '${OWNER_ID}', '${OWNER_ID}', '${OWNER_ID}') returning id`,
  ).split("\n");

  await signIn(page, "owner");
  await page.goto("/home");
  await expect(page.getByRole("region", { name: "While you were away" })).toBeVisible();

  // The visit ended two hours ago; then a colleague changed two of my tasks.
  sql(`update home_visit set last_seen_at = now() - interval '2 hours' where user_id = '${OWNER_ID}'`);
  sql(`insert into activity_event (organization_id, actor_id, verb, source_type, source_id, summary, metadata) values
    ('${org}', '${staff}', 'updated', 'task', '${movedId}', 'updated a task',
     '{"changes":[{"field":"due_at","from":"2026-12-10","to":"2026-12-20"}]}'),
    ('${org}', '${staff}', 'updated', 'task', '${blockedId}', 'updated a task',
     '{"changes":[{"field":"status","from":"ready","to":"blocked"},{"field":"blocked_reason","from":null,"to":"Waiting on the venue"}]}')`);

  await page.reload();
  const digest = page.getByRole("region", { name: "While you were away" });
  await expect(digest.getByText(/^Changes since /)).toBeVisible();
  // Only this run's entries: earlier runs may have left others in the window.
  const entries = digest.getByRole("listitem").filter({ hasText: suffix });
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Newly blocked");
  await expect(entries.nth(0)).toContainText(blocked);
  await expect(entries.nth(0)).toContainText("Blocked: Waiting on the venue · By QA Staff");
  await expect(entries.nth(1)).toContainText("Deadline moved");
  await expect(entries.nth(1)).toContainText(/Moved later: .+ to .+/);
  expect(await axeProblems(page), "digest accessibility").toEqual([]);

  // A reload during the same visit keeps the digest.
  await page.reload();
  await expect(page.getByRole("region", { name: "While you were away" }).getByText(blocked)).toBeVisible();

  // The entry opens the task.
  await page.getByRole("region", { name: "While you were away" }).getByRole("link", { name: blocked }).click();
  await expect(page).toHaveURL(new RegExp(`/my-work\\?task=${blockedId}`));
});

test("Home speaks French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Accueil", level: 1 })).toBeVisible();
  for (const name of ["Maintenant", "Aujourd’hui", "En attente", "Reprendre", "Décisions", "Changements"]) {
    await expect(page.getByRole("region", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  expect(await axeProblems(page), "French Home accessibility").toEqual([]);
  await page.goto("/home/world");
  await expect(page.getByRole("heading", { name: "Mon univers", level: 1 })).toBeVisible();
});

test("Home stays hidden while the switch is off [switch off]", async ({ page }) => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
  try {
    await signIn(page, "owner");
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await page.goto("/home/world");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
  }
});
