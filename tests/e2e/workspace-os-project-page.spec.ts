import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * The living project page (M19, epic #199): calculated health and progress
 * with reasons, and query blocks. Behind wos_home, turned on for this run.
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
const TODAY = "(now() at time zone 'America/Toronto')::date";
let projectId = "";
let suffix = "";

test.beforeAll(() => {
  sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
  suffix = randomUUID().slice(0, 8);
  const org = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}'`);
  projectId = sql(
    `insert into project (organization_id, name, owner_id, created_by, target_date, health)
     values ('${org}', 'Living page ${suffix}', '${OWNER_ID}', '${OWNER_ID}', ${TODAY} + 10, 'on_track') returning id`,
  ).split("\n")[0];
  sql(`insert into task (organization_id, project_id, title, created_by, status, completed_at)
       values ('${org}', '${projectId}', 'Book the hall ${suffix}', '${OWNER_ID}', 'completed', now())`);
  sql(`insert into task (organization_id, project_id, title, created_by, status, blocked_reason, due_at)
       values ('${org}', '${projectId}', 'Print posters ${suffix}', '${OWNER_ID}', 'blocked', 'Waiting on the logo', ${TODAY} + 5)`);
  sql(`insert into milestone (project_id, name, due_date, status) values ('${projectId}', 'Venue confirmed ${suffix}', ${TODAY} - 2, 'planned')`);
  sql(`insert into decision (organization_id, project_id, title, decided_by) values ('${org}', '${projectId}', 'Use the east hall ${suffix}', '${OWNER_ID}')`);
  sql(`insert into risk (organization_id, project_id, title, likelihood, impact, status, created_by)
       values ('${org}', '${projectId}', 'Speaker cancels ${suffix}', 'high', 'high', 'open', '${OWNER_ID}')`);
  // Files: one live link and one archived one; only the live one may show.
  sql(`insert into document (organization_id, project_id, title, kind, url, visibility, created_by)
       values ('${org}', '${projectId}', 'Hall contract ${suffix}', 'link', 'https://drive.google.com/file/d/${suffix}/view', 'organization', '${OWNER_ID}')`);
  sql(`insert into document (organization_id, project_id, title, kind, url, visibility, created_by, archived_at)
       values ('${org}', '${projectId}', 'Old contract ${suffix}', 'link', 'https://drive.google.com/file/d/${suffix}-old/view', 'organization', '${OWNER_ID}', now())`);
});
test.afterAll(() => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
});

test("the living project page calculates health and progress, and shows each block", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/home/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: `Living page ${suffix}`, level: 1 })).toBeVisible();

  const health = page.getByRole("region", { name: "Health" });
  await expect(health.getByText("At risk")).toBeVisible();
  await expect(health.getByText("On track")).toBeVisible(); // what was last reported
  for (const reason of [
    "1 milestone is overdue",
    "1 task is blocked",
    "1 open risk is high likelihood and high impact",
    "50% done with 10 days to the target",
  ]) {
    await expect(health.getByText(reason)).toBeVisible();
  }
  const progress = page.getByRole("region", { name: "Progress" });
  await expect(progress.getByRole("progressbar", { name: "Project progress" })).toHaveAttribute("aria-valuenow", "50");
  await expect(progress.getByText("1 of 2 tasks done")).toBeVisible();

  await expect(page.getByRole("region", { name: "Open tasks" }).getByRole("link", { name: `Print posters ${suffix}` })).toBeVisible();
  await expect(page.getByRole("region", { name: "Open tasks" }).getByText(`Book the hall ${suffix}`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recent decisions" }).getByText(`Use the east hall ${suffix}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Milestones" }).getByText(`Venue confirmed ${suffix}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Risks" }).getByText("Likelihood: high")).toBeVisible();
  // Non-task types come through the query engine: decisions, milestones, risks above, and files here.
  const files = page.getByRole("region", { name: "Files" });
  await expect(files.getByRole("link", { name: `Hall contract ${suffix}` })).toBeVisible();
  await expect(files.getByText(`Old contract ${suffix}`)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Recent decisions" }).getByRole("link", { name: `Use the east hall ${suffix}` })).toHaveAttribute(
    "href",
    `/projects/${projectId}`,
  );
  await expect(page.getByRole("region", { name: "Milestones" }).getByText("Planned")).toBeVisible();
  await expect(page.getByRole("region", { name: "Activity" })).toBeVisible();
  expect(await axeProblems(page), "living project page accessibility").toEqual([]);

  // Blocks open their records.
  await page.getByRole("region", { name: "Open tasks" }).getByRole("link", { name: `Print posters ${suffix}` }).click();
  await expect(page).toHaveURL(/\/my-work\?task=/);
});

test("someone who cannot read the project gets not found", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.goto(`/home/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  await expect(page.getByText(`Living page ${suffix}`)).toHaveCount(0);
  await signOut(page);
});

test("the living project page speaks French", async ({ page, context }) => {
  await signIn(page, "owner");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto(`/home/projects/${projectId}`);
  const health = page.getByRole("region", { name: "État" });
  await expect(health.getByText("À risque")).toBeVisible();
  await expect(health.getByText("1 jalon est en retard")).toBeVisible();
  await expect(page.getByRole("region", { name: "Tâches ouvertes" })).toBeVisible();
  expect(await axeProblems(page), "French living project page accessibility").toEqual([]);
});

test("the living project page stays hidden while the switch is off", async ({ page }) => {
  sql(`update feature_flag set enabled = false where key = 'wos_home' and organization_id is null`);
  try {
    await signIn(page, "owner");
    await page.goto(`/home/projects/${projectId}`);
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
  } finally {
    sql(`update feature_flag set enabled = true where key = 'wos_home' and organization_id is null`);
  }
});
