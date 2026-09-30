import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workflows as a step graph (Workspace OS M14c), behind wos_workflows_v2.
 *
 * An admin builds a workflow (a condition, then an action), saves it, test-runs
 * it against a real task, and finds the test run in the run history. Nothing
 * changes on the task: a test run checks actions and does not carry them out.
 * Who may read and write workflows is proven in supabase/tests/workflows-graph.sql.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function setSwitch(on: boolean) {
  sql(`update feature_flag set enabled = ${on} where key = 'wos_workflows_v2' and organization_id is null`);
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, `axe on ${label}`).toEqual([]);
}

test.describe("workflows v2", () => {
  test.afterAll(() => setSwitch(false));

  test("the screens do not exist while the switch is off", async ({ page }) => {
    setSwitch(false);
    await signIn(page, "admin");
    await page.goto("/workflows");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New workflow" })).toHaveCount(0);
  });

  test("an admin builds, saves, test-runs a workflow and sees the run", async ({ page }) => {
    test.setTimeout(180_000);
    setSwitch(true);
    const name = `E2E blocked tasks ${Date.now()}`;
    const org = sql(`select organization_id::text from organization_membership m
      join user_profile p on p.id = m.user_id where p.email = 'qa-admin@example.com' limit 1`);
    const admin = sql(`select id::text from user_profile where email = 'qa-admin@example.com'`);
    const taskId = sql(`insert into task (organization_id, title, created_by, priority)
      values ('${org}', 'E2E workflow task', '${admin}', 'low') returning id::text`);

    try {
      await signIn(page, "admin");
      await page.goto("/workflows");
      await expect(page.getByRole("heading", { name: "Workflows", level: 1 })).toBeVisible();
      await axe(page, "/workflows");

      // Keyboard: reach "New workflow" and open it with Enter.
      const create = page.getByRole("link", { name: "New workflow" });
      await create.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL("**/workflows/new");

      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByRole("button", { name: "Add a condition" }).click();
      await page.getByLabel("Compared with").fill("blocked");
      await page.getByRole("button", { name: "Add an action" }).click();
      await page.getByLabel("New priority").selectOption("critical");
      await axe(page, "/workflows/new");
      await page.getByRole("button", { name: "Save workflow" }).click();

      await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(page.getByLabel("Compared with")).toHaveValue("blocked");

      // Test run with sample data: the task goes from in progress to blocked.
      await page.getByLabel("Item id").fill(taskId);
      await page.getByLabel("Status before").selectOption("in_progress");
      await page.getByLabel("Status after").selectOption("blocked");
      await page.getByRole("button", { name: "Run test" }).click();
      await expect(page.getByText(/^Test run #\d+: Succeeded$/)).toBeVisible({ timeout: 30_000 });
      const steps = page.getByRole("list", { name: "Test run" });
      await expect(steps.getByRole("listitem")).toHaveCount(3);

      // The run is in the history, marked as a test.
      const history = page.getByRole("table", { name: "Run history" });
      await expect(history.getByRole("row").filter({ hasText: "Test" }).filter({ hasText: "Succeeded" })).toHaveCount(1);
      await axe(page, "/workflows/[id]");

      // A test run changes nothing.
      expect(sql(`select priority::text from task where id = '${taskId}'`)).toBe("low");

      // The list shows it, in French too.
      await page.goto("/workflows");
      await expect(page.getByRole("link", { name: `Open ${name}` })).toBeVisible();
      const origin = new URL(page.url()).origin;
      await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: origin }]);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Flux de travail", level: 1 })).toBeVisible();
      await expect(page.getByRole("link", { name: "Nouveau flux" })).toBeVisible();
      await axe(page, "/workflows (fr-CA)");
    } finally {
      await page.context().clearCookies({ name: "qbbe-locale" });
      sql(`delete from workflow_rule where name = '${name.replace(/'/g, "''")}'`);
      sql(`delete from task where id = '${taskId}'`);
    }
  });

  test("an admin edits branches as JSON and uses the stop switch", async ({ page }) => {
    test.setTimeout(180_000);
    setSwitch(true);
    const name = `E2E branch ${Date.now()}`;
    const org = sql(`select organization_id::text from organization_membership m
      join user_profile p on p.id = m.user_id where p.email = 'qa-admin@example.com' limit 1`);
    const admin = sql(`select id::text from user_profile where email = 'qa-admin@example.com'`);
    const graph = JSON.stringify({
      version: 1, trigger: { objectTypes: ["task"], verbs: ["updated"] }, start: "a",
      steps: [{ id: "a", kind: "action", action: "task.set_priority", input: { taskId: "{{event.object.id}}", priority: "high" }, next: null }],
    });
    const id = sql(`insert into workflow_rule (organization_id, name, trigger_event, engine, graph, created_by)
      values ('${org}', '${name}', 'object_event', 'graph_v2', '${graph}', '${admin}') returning id::text`);
    try {
      await signIn(page, "admin");
      await page.goto(`/workflows/${id}`);
      await page.getByRole("link", { name: "Edit as JSON" }).click();
      const definition = page.getByLabel("Workflow definition (JSON)");
      await expect(definition).toBeVisible();

      // Broken JSON is caught before it is sent.
      await definition.fill("{ nope");
      await page.getByRole("button", { name: "Save workflow" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "That is not valid JSON" })).toBeVisible();

      // A branch the step list cannot show.
      await definition.fill(JSON.stringify({
        version: 1, trigger: { objectTypes: ["task"], verbs: ["updated"] }, start: "check",
        steps: [
          { id: "check", kind: "branch", when: { path: "event.changes.status.after", op: "eq", value: "blocked" }, then: "raise", else: null },
          { id: "raise", kind: "action", action: "task.set_priority", input: { taskId: "{{event.object.id}}", priority: "high" },
            retry: { attempts: 3, backoffSeconds: 30 }, next: null },
        ],
      }));
      await page.getByRole("button", { name: "Save workflow" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Workflow saved." })).toBeVisible();
      await page.goto(`/workflows/${id}`);
      await expect(page.getByText("This workflow uses steps the step list cannot show")).toBeVisible();
      await axe(page, "/workflows/[id]?mode=json");

      // The stop switch.
      await page.getByRole("button", { name: "Stop this workflow now" }).click();
      await expect(page.getByRole("button", { name: "Allow runs again" })).toBeVisible();
      expect(sql(`select stopped_at is not null from workflow_rule where id = '${id}'`)).toBe("t");
      await page.getByRole("button", { name: "Allow runs again" }).click();
      await expect(page.getByRole("button", { name: "Stop this workflow now" })).toBeVisible();
      expect(sql(`select stopped_at is null from workflow_rule where id = '${id}'`)).toBe("t");
    } finally {
      sql(`delete from workflow_rule where id = '${id}'`);
    }
  });

  test("a reviewer approves a workflow review on its page", async ({ page }) => {
    setSwitch(true);
    const org = sql(`select organization_id::text from organization_membership m
      join user_profile p on p.id = m.user_id where p.email = 'qa-staff@example.com' limit 1`);
    const staff = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);
    const rule = sql(`insert into workflow_rule (organization_id, name, trigger_event, engine, graph)
      values ('${org}', 'E2E review ${Date.now()}', 'object_event', 'graph_v2',
      '{"version":1,"trigger":{"objectTypes":[],"verbs":[]},"start":null,"steps":[]}') returning id::text`);
    const run = sql(`insert into workflow_execution (organization_id, rule_id, rule_name, trigger_event, source_type, source_id, outcome, engine)
      values ('${org}', '${rule}', 'E2E review', 'object_event', 'task', gen_random_uuid(), 'waiting', 'graph_v2') returning id::text`);
    const review = sql(`insert into workflow_review (organization_id, execution_id, step_id, reviewer_id, instructions)
      values ('${org}', '${run}', 'check', '${staff}', 'Is the budget right?') returning id::text`);
    try {
      await signIn(page, "staff");
      await page.goto(`/workflows/reviews/${review}`);
      await expect(page.getByRole("heading", { name: "Review requested", level: 1 })).toBeVisible();
      await expect(page.getByText("Is the budget right?")).toBeVisible();
      await axe(page, "/workflows/reviews/[id]");
      await page.getByLabel("Comment (optional)").fill("Yes");
      await page.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("You approved this review.")).toBeVisible();
      expect(sql(`select status || ':' || coalesce(comment, '') from workflow_review where id = '${review}'`)).toBe("approved:Yes");
    } finally {
      sql(`delete from workflow_rule where id = '${rule}'`);
    }
  });

  test("staff cannot open the workflow screens", async ({ page }) => {
    setSwitch(true);
    await signIn(page, "staff");
    await page.goto("/workflows");
    await expect(page).not.toHaveURL(/\/workflows$/);
  });
});
