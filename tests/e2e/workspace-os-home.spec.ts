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
       values ('${org}', '${overdue}', '${OWNER_ID}', '${OWNER_ID}', '${OWNER_ID}', current_date - 3),
              ('${org}', '${asked}', '${OWNER_ID}', '${OWNER_ID}', '${VOLUNTEER_ID}', current_date + 2)`);

  await signIn(page, "owner");
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  const now = page.getByRole("region", { name: /^Now/ });
  await expect(now.getByRole("link", { name: overdue })).toBeVisible();
  await expect(now.getByText(/Overdue since/).first()).toBeVisible();
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
  // The task asked of the volunteer is theirs now.
  await expect(page.getByRole("region", { name: /^Now|^Today|^Continue/ }).getByRole("link", { name: asked })).toHaveCount(0);
  await page.goto("/home/world");
  await expect(page.getByRole("region", { name: /^My tasks/ }).getByRole("link", { name: asked })).toBeVisible();
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

test("Home stays hidden while the switch is off", async ({ page }) => {
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
