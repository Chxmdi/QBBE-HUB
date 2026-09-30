import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-10: decisions with the full record, behind `wos_decisions_v2`.
 *
 * A project manager fills in the problem, options, evidence, reasoning and a
 * revisit date, adds a participant, and sees it on the project's decision
 * trail. The revisit job then notifies both people once. Someone outside the
 * project (the guest) sees the not-found page.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const NOT_FOUND = "Not found — or not yours to see";
const JOB_SECRET = process.env.CRON_JOB_SECRET ?? "";

async function axeProblems(page: Page): Promise<string[]> {
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

function setSwitch(on: boolean) {
  sql(`update public.feature_flag set enabled = ${on} where key = any (array['wos_decisions_v2']);`);
}

test.afterAll(() => setSwitch(false));

test("a project manager records the full decision, and the revisit reminder goes out once", async ({ page, request }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const title = `Move the workshop online ${stamp}`;
  const [projectId, decisionId] = sql(`
    with who as (
      select u.id as user_id, m.organization_id
      from auth.users u join public.organization_membership m on m.user_id = u.id
      where u.email = 'qa-staff@example.com'
    ), prog as (
      insert into public.program (organization_id, name, slug, created_by)
      select organization_id, 'Decisions v2 ${stamp}', 'dv2-${stamp}', user_id from who
      returning id, organization_id
    ), proj as (
      insert into public.project (organization_id, program_id, name, owner_id, created_by)
      select prog.organization_id, prog.id, 'Decisions v2 ${stamp}', who.user_id, who.user_id from prog, who
      returning id, organization_id
    ), grant_row as (
      insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
      select proj.organization_id, proj.id, who.user_id, 'project_manager'::public.project_access_role, 'direct'::public.scoped_grant_source, who.user_id from proj, who
      union all
      select proj.organization_id, proj.id, v.id, 'read_only'::public.project_access_role, 'direct'::public.scoped_grant_source, who.user_id
      from proj, who, auth.users v where v.email = 'qa-volunteer@example.com'
    ), dec as (
      insert into public.decision (organization_id, project_id, title, detail, decided_by)
      select proj.organization_id, proj.id, '${title}', 'Earlier rationale', who.user_id from proj, who
      returning id, project_id
    )
    select project_id || '|' || id from dec;
  `).split("|");

  setSwitch(false);
  await signIn(page, "staff");
  await page.goto(`/decisions/${decisionId}`);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();

  setSwitch(true);
  await page.goto(`/decisions/${decisionId}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);

  const today = sql(`select to_char(now() at time zone 'America/Toronto', 'YYYY-MM-DD');`);
  await page.getByLabel("Problem", { exact: true }).fill("The hall is too small");
  await page.getByLabel("Options considered").fill("Rent a bigger hall\nSplit into two sessions\nMove online");
  await page.getByLabel("Evidence", { exact: true }).fill("Registrations doubled");
  await page.getByLabel("Reasoning", { exact: true }).fill("Online fits everyone at no cost");
  await page.getByLabel("Revisit date (optional)").fill(today);
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Decision saved." })).toBeVisible({ timeout: 30_000 });

  // Participants, from the keyboard.
  await page.getByLabel("Person", { exact: true }).selectOption({ label: "QA Volunteer" });
  await page.getByRole("button", { name: "Add participant" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Remove QA Volunteer" })).toBeVisible({ timeout: 30_000 });

  expect(
    sql(`select problem || '|' || jsonb_array_length(options_considered) || '|' || revisit_on
         from public.decision where id = '${decisionId}';`),
  ).toBe(`The hall is too small|3|${today}`);

  // The project's decision trail.
  await page.getByRole("link", { name: "Decision trail" }).click();
  await expect(page).toHaveURL(new RegExp(`/decisions/trail/${projectId}$`));
  await expect(page.getByRole("link", { name: title })).toBeVisible();
  await expect(page.getByText("Due for a revisit")).toBeVisible();
  await expect(page.getByText("Split into two sessions")).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);

  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des décisions" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });

  // The revisit reminder: both people once, and not again on a second run.
  test.skip(!JOB_SECRET, "CRON_JOB_SECRET is not set, so the job route cannot be called");
  for (let run = 0; run < 2; run += 1) {
    const response = await request.post("/api/jobs/decision-revisit-reminders", {
      headers: { "x-job-secret": JOB_SECRET },
    });
    expect(response.ok()).toBeTruthy();
  }
  expect(
    sql(`select count(*) from public.notification where source_type = 'decision' and source_id = '${decisionId}';`),
  ).toBe("2");

  await signOut(page);
  await signIn(page, "guest");
  await page.goto(`/decisions/trail/${projectId}`);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
});
