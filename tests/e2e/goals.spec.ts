import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS V1-11: goals, behind `wos_goals`.
 *
 * A program lead creates a goal, links a project and an outcome metric, and
 * the progress moves by itself when a task is finished elsewhere. A volunteer
 * outside the program sees the not-found page.
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
  sql(`update public.feature_flag set enabled = ${on} where key = any (array['wos_goals']);`);
}

test.afterAll(() => setSwitch(false));

test("goals are hidden while the switch is off [switch off]", async ({ page }) => {
  setSwitch(false);
  await signIn(page, "staff");
  await page.goto("/goals");
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
});

test("a program lead links a project and a metric, and the goal's progress follows the work", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const program = `Goals ${stamp}`;
  const projectName = `Literacy nights ${stamp}`;
  const metricName = `Families reached ${stamp}`;
  // Program and lead grant first: a project added afterwards inherits the
  // grant through the database trigger, as it does in the app.
  const who = `select u.id as user_id, m.organization_id
    from auth.users u join public.organization_membership m on m.user_id = u.id
    where u.email = 'qa-staff@example.com'`;
  const programId = sql(`
    with who as (${who}), prog as (
      insert into public.program (organization_id, name, slug, created_by)
      select organization_id, '${program}', 'goals-${stamp}', user_id from who
      returning id, organization_id
    )
    insert into public.program_access_grant (organization_id, program_id, user_id, role, source, created_by)
    select prog.organization_id, prog.id, who.user_id, 'lead'::public.program_access_role,
      'direct'::public.scoped_grant_source, who.user_id from prog, who
    returning program_id;
  `);
  sql(`
    with who as (${who}), metric as (
      -- An explicit unit: the default ("people") is a lowercase English word,
      -- and the French sweep in translated-workspace.spec.ts, which later reads
      -- Home on the same database, cannot tell it from untranslated text.
      insert into public.outcome_metric (organization_id, program_id, name, unit, baseline, target, created_by)
      select organization_id, '${programId}', '${metricName}', 'Families ${stamp}', 0, 10, user_id from who
      returning id, organization_id
    )
    insert into public.outcome_measurement (organization_id, metric_id, measured_on, value)
    select organization_id, id, current_date, 5 from metric;
  `);
  const projectId = sql(`
    with who as (${who})
    insert into public.project (organization_id, program_id, name, owner_id, created_by)
    select organization_id, '${programId}', '${projectName}', user_id, user_id from who
    returning id;
  `);
  sql(`
    with who as (${who})
    insert into public.task (organization_id, project_id, title, created_by, status, completed_at)
    select who.organization_id, '${projectId}', t.title, who.user_id, t.status::public.task_status,
      case when t.status = 'completed' then now() end
    from who, (values ('Book rooms ${stamp}', 'completed'), ('Recruit tutors ${stamp}', 'in_progress')) as t(title, status);
  `);

  setSwitch(true);
  await signIn(page, "staff");
  await page.goto("/goals");
  await expect(page.getByRole("heading", { level: 1, name: "Goals" })).toBeVisible();
  expect(await axeProblems(page)).toEqual([]);

  const title = `Double family literacy ${stamp}`;
  await page.getByLabel("Goal", { exact: true }).fill(title);
  await page.getByLabel("Program", { exact: true }).selectOption({ label: program });
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuetext", "Not measured yet");

  await page.getByLabel("Project to link").selectOption({ label: projectName });
  await page.getByRole("button", { name: "Link project" }).click();
  await expect(page.getByRole("link", { name: projectName })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Metric to link").selectOption({ label: metricName });
  await page.getByRole("button", { name: "Link metric" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Latest 5 of target 10")).toBeVisible({ timeout: 30_000 });
  // Half the tasks and half-way to the target.
  await expect(page.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "50");
  expect(await axeProblems(page)).toEqual([]);

  // Finishing the other task elsewhere moves the goal without touching it.
  sql(`update public.task set status = 'completed', completed_at = now() where title = 'Recruit tutors ${stamp}';`);
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Progress" })).toHaveAttribute("aria-valuenow", "75");
  await expect(page.getByText("2 of 2 tasks done")).toBeVisible();

  const origin = new URL(page.url()).origin;
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
  await page.reload();
  await expect(page.getByRole("progressbar", { name: "Avancement" })).toHaveAttribute("aria-valuetext", "75 % terminé");
  expect(await axeProblems(page)).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });

  const goalUrl = page.url();
  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(goalUrl);
  await expect(page.getByRole("heading", { name: NOT_FOUND })).toBeVisible();
  expect(projectId).toMatch(/^[0-9a-f-]{36}$/);
});
