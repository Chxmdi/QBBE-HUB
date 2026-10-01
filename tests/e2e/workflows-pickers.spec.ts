import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workflow pickers, step editors, example events and failures (U10), behind
 * wos_workflows_v2.
 *
 * An admin builds a rule without typing a path or an id, test-runs it against
 * a real recent event and reads what each step would have done; every step
 * kind opens in the list editor and saves back unchanged; and a failed run is
 * retried from the cross-workflow failures view.
 */

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

function setSwitch(on: boolean) {
  sql(`update feature_flag set enabled = ${on} where key = 'wos_workflows_v2' and organization_id is null`);
}

async function axe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations, `axe on ${label}`).toEqual([]);
}

function adminContext() {
  const org = sql(`select organization_id::text from organization_membership m
    join user_profile p on p.id = m.user_id where p.email = 'qa-admin@example.com' limit 1`);
  const admin = sql(`select id::text from user_profile where email = 'qa-admin@example.com'`);
  return { org, admin };
}

const quote = (text: string) => text.replace(/'/g, "''");

test.describe("workflow pickers", () => {
  test.afterAll(() => setSwitch(false));

  test("a rule is built with pickers and test-run against a recent event [switches on]", async ({ page }) => {
    test.setTimeout(180_000);
    setSwitch(true);
    const { org, admin } = adminContext();
    const stamp = Date.now();
    const name = `E2E pickers ${stamp}`;
    const title = `E2E picker task ${stamp}`;
    const summary = `E2E picker event ${stamp}`;
    const staff = sql(`select id::text || '|' || full_name from user_profile where email = 'qa-staff@example.com'`).split("|");
    const taskId = sql(`insert into task (organization_id, title, created_by, priority)
      values ('${org}', '${title}', '${admin}', 'low') returning id::text`);
    sql(`insert into activity_event (organization_id, actor_id, verb, source_type, source_id, summary, metadata)
      values ('${org}', '${admin}', 'updated', 'task', '${taskId}', '${summary}',
      '{"changes":[{"property":"status","before":"in_progress","after":"blocked"}]}')`);

    try {
      await signIn(page, "admin");
      await page.goto("/workflows/new");
      await page.getByLabel("Name", { exact: true }).fill(name);

      // The trigger's property, picked from the catalog with the keyboard.
      const trigger = page.getByRole("combobox", { name: "Only when this property changes" });
      await trigger.fill("Prior");
      await expect(page.getByRole("option", { name: /^Priority/ })).toBeVisible();
      await trigger.fill("Statu");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("Enter");
      await expect(trigger).toHaveValue("Status");

      // A condition on the new status, with the property picker.
      await page.getByRole("button", { name: "Add a condition" }).click();
      const property = page.getByRole("combobox", { name: "Property", exact: true });
      await property.fill("status");
      await expect(page.getByRole("listbox", { name: "Property" }).getByRole("group", { name: "Choices" })).toBeVisible();
      await page.getByRole("option", { name: /^Status \(new value\)/ }).click();
      await expect(property).toHaveValue("Status (new value)");
      await page.getByRole("button", { name: "Advanced" }).first().click();
      await expect(page.getByLabel("Path (advanced)")).toHaveValue("event.changes.status.after");
      await expect(page.getByLabel("Test", { exact: true }).locator("option")).toHaveText(["is", "is not", "is one of", "is empty", "is not empty"]);
      await page.getByLabel("Compared with").fill("blocked");

      // Raise the priority of the item that changed.
      await page.getByRole("button", { name: "Add an action" }).click();
      await page.getByLabel("New priority").selectOption("critical");

      // Assign the task, found by its title, to a person found by name.
      await page.getByRole("button", { name: "Add an action" }).click();
      const third = page.getByRole("group", { name: /^Step 3 · Take an action/ });
      await third.getByLabel("Action").selectOption("task.assign");
      const task = third.getByRole("combobox", { name: "Task" });
      await task.fill(`picker task ${stamp}`);
      await expect(third.getByRole("option", { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(third.getByLabel("Task id (advanced)")).toHaveValue(taskId);
      const person = third.getByRole("combobox", { name: /^Person to assign/ });
      await person.fill(staff[1].slice(0, 5));
      await expect(third.getByRole("option", { name: new RegExp(`^${staff[1]}`) })).toBeVisible({ timeout: 15_000 });
      await third.getByRole("option", { name: new RegExp(`^${staff[1]}`) }).click();
      await expect(third.getByLabel("Person id (advanced)")).toHaveValue(staff[0]);
      await axe(page, "/workflows/new with pickers");

      await page.getByRole("button", { name: "Save workflow" }).click();
      await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      const rule = page.url().split("/").at(-1)!;
      const graph = JSON.parse(sql(`select graph::text from workflow_rule where id = '${rule}'`));
      expect(graph.trigger).toEqual({ objectTypes: ["task"], verbs: ["updated"], changedProperty: "status" });
      expect(graph.steps[0].when).toEqual({ path: "event.changes.status.after", op: "eq", value: "blocked" });
      expect(graph.steps[2].input).toEqual({ taskId, assigneeId: staff[0] });
      // After the reload the saved ids are shown by name again.
      const saved = page.getByRole("group", { name: /^Step 3 · Take an action/ });
      await expect(saved.getByRole("combobox", { name: "Task" })).toHaveValue(title);
      await expect(saved.getByRole("combobox", { name: /^Person to assign/ })).toHaveValue(staff[1]);

      // Test run against the recent event, picked from the list.
      const example = page.getByRole("combobox", { name: "Recent event" });
      await example.fill(summary);
      await expect(page.getByRole("option", { name: new RegExp(summary) })).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page.getByText(`Replaying event: ${summary}`)).toBeVisible();
      await expect(page.getByLabel("Item id", { exact: true })).toHaveValue(taskId);
      await expect(page.getByLabel("Status after")).toHaveValue("blocked");
      await page.getByRole("button", { name: "Run test" }).click();
      await expect(page.getByText(/^Test run #\d+: Succeeded$/)).toBeVisible({ timeout: 30_000 });

      const steps = page.getByRole("list", { name: "Test run" });
      await expect(steps.getByRole("listitem")).toHaveCount(4);
      await expect(steps.getByRole("listitem").first()).toContainText("Trigger: Done");
      await expect(steps).toContainText(`Changed task ${taskId}`);
      await expect(steps).toContainText("status: from in_progress to blocked");
      await expect(steps).toContainText("event.changes.status.after is blocked · it was blocked");
      await expect(steps).toContainText("The test passed.");
      await expect(steps).toContainText(`Would set the priority of task ${taskId} to Critical.`);
      await expect(steps).toContainText(`Would assign task ${taskId} to ${staff[0]}.`);
      await expect(steps).toContainText("The workflow's owner may do this.");
      await axe(page, "/workflows/[id] after a test run");
      await page.getByRole("region", { name: "Test run" }).screenshot({ path: "test-results/workflows-pickers-test-run.png" });

      // A test run changes nothing.
      expect(sql(`select priority::text || ':' || coalesce(assignee_id::text, '') from task where id = '${taskId}'`)).toBe("low:");
    } finally {
      sql(`delete from workflow_rule where name = '${quote(name)}'`);
      sql(`delete from activity_event where summary = '${quote(summary)}'`);
      sql(`delete from task where id = '${taskId}'`);
    }
  });

  test("every step kind round-trips through the list editor without JSON mode [switches on]", async ({ page }) => {
    test.setTimeout(180_000);
    setSwitch(true);
    const { org, admin } = adminContext();
    const stamp = Date.now();
    const subName = `E2E sub ${stamp}`;
    const name = `E2E every kind ${stamp}`;
    const sub = sql(`insert into workflow_rule (organization_id, name, trigger_event, engine, graph, created_by)
      values ('${org}', '${subName}', 'object_event', 'graph_v2',
      '{"version":1,"trigger":{"objectTypes":[],"verbs":[]},"start":null,"steps":[]}', '${admin}') returning id::text`);
    const graph = {
      version: 1,
      trigger: { objectTypes: ["task"], verbs: ["updated"], changedProperty: "status" },
      start: "check",
      steps: [
        { id: "check", kind: "condition", label: "Only blocked", when: { or: [
          { path: "event.changes.status.after", op: "eq", value: "blocked" },
          { path: "event.changes.priority.after", op: "in", value: ["high", "critical"] },
        ] }, next: "route" },
        { id: "route", kind: "branch", when: { path: "event.changes.assignee.after", op: "is_empty" }, then: "each", else: "pause" },
        { id: "each", kind: "loop", items: "event.changes.watchers.after", body: "raise", next: "pause" },
        { id: "raise", kind: "action", action: "task.set_priority", input: { taskId: "{{event.object.id}}", priority: "high" },
          retry: { attempts: 3, backoffSeconds: 30 }, next: null },
        { id: "pause", kind: "wait", seconds: 600, next: "until" },
        { id: "until", kind: "wait", until: "event.changes.due.after", next: "approve" },
        { id: "approve", kind: "approval", subjectType: "contract", title: "Approve {{event.summary}}", description: "Please look", next: "review" },
        { id: "review", kind: "review", reviewer: "{{event.actor.id}}", instructions: "Check the budget", next: "hook" },
        { id: "hook", kind: "webhook", url: "https://example.com/hook", body: { id: "{{event.object.id}}", nested: { n: 1 } },
          retry: { attempts: 2, backoffSeconds: 10 }, next: "mail" },
        { id: "mail", kind: "email", to: "qa-admin@example.com", subject: "Heads up", body: "Task {{event.object.id}} changed.", next: "sub" },
        { id: "sub", kind: "subworkflow", workflowId: sub, next: null },
      ],
    };
    const id = sql(`insert into workflow_rule (organization_id, name, trigger_event, engine, graph, created_by)
      values ('${org}', '${name}', 'object_event', 'graph_v2', '${quote(JSON.stringify(graph))}', '${admin}') returning id::text`);
    try {
      await signIn(page, "admin");
      await page.goto(`/workflows/${id}`);
      await expect(page.getByText("This workflow uses steps the step list cannot show")).toHaveCount(0);
      await expect(page.getByLabel("Workflow definition (JSON)")).toHaveCount(0);
      const kinds = [
        "Check a condition", "Branch", "Go through a list", "Take an action", "Wait", "Wait",
        "Ask for approval", "Ask a person to review", "Call a webhook", "Send an email", "Run another workflow",
      ];
      for (const [index, kind] of kinds.entries()) {
        await expect(page.getByRole("group", { name: new RegExp(`^Step ${index + 1} · ${kind}`) })).toBeVisible();
      }
      await expect(page.getByLabel("These tests")).toHaveValue("any");
      await expect(page.getByLabel("Workflow to run")).toHaveValue(sub);
      await expect(page.getByRole("group", { name: /^Step 2 · Branch/ }).getByLabel("Otherwise, go to")).toHaveValue("step:pause");
      await axe(page, "/workflows/[id] with every step kind");

      // Saved from the list as it is: the stored graph does not change.
      await page.getByRole("button", { name: "Save workflow" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Workflow saved." })).toBeVisible({ timeout: 30_000 });
      expect(JSON.parse(sql(`select graph::text from workflow_rule where id = '${id}'`))).toEqual(graph);
      expect(sql(`select definition_version from workflow_rule where id = '${id}'`)).toBe("2");

      // A new kind of step is added from the list and saved without JSON.
      await page.getByLabel("Other kind of step").selectOption("wait");
      await page.getByRole("button", { name: "Add step" }).click();
      const added = page.getByRole("group", { name: /^Step 12 · Wait/ });
      await added.getByLabel("Seconds").fill("120");
      await page.getByRole("group", { name: /^Step 11 · Run another workflow/ }).getByLabel("After this step").selectOption("following");
      await page.getByRole("button", { name: "Save workflow" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Workflow saved." })).toBeVisible({ timeout: 30_000 });
      const saved = JSON.parse(sql(`select graph::text from workflow_rule where id = '${id}'`));
      expect(saved.steps.at(-1)).toEqual({ id: "step-12", kind: "wait", seconds: 120, next: null });
      expect(saved.steps.at(-2)).toMatchObject({ id: "sub", next: "step-12" });
    } finally {
      sql(`delete from workflow_rule where id in ('${id}', '${sub}')`);
    }
  });

  test("a failed run is retried from the failures view [switches on]", async ({ page }) => {
    test.setTimeout(180_000);
    setSwitch(true);
    const { org, admin } = adminContext();
    const missingTask = "00000000-0000-4000-8000-000000000000";
    const graph = JSON.stringify({
      version: 1, trigger: { objectTypes: ["task"], verbs: ["updated"] }, start: "send",
      steps: [{ id: "send", kind: "action", action: "task.set_priority", input: { taskId: missingTask, priority: "high" }, next: null }],
    });
    const name = `E2E failures ${Date.now()}`;
    const rule = sql(`insert into workflow_rule (organization_id, name, trigger_event, engine, graph, created_by, run_as_user_id)
      values ('${org}', '${name}', 'object_event', 'graph_v2', '${graph}', '${admin}', '${admin}') returning id::text`);
    const event = JSON.stringify({
      id: "11111111-2222-4333-8444-666666666666", organizationId: org, object: { id: missingTask, type: "task" },
      actor: { kind: "person", id: admin }, verb: "updated", changes: [], summary: "e2e", occurredAt: new Date().toISOString(),
    });
    const run = sql(`insert into workflow_execution (organization_id, rule_id, rule_name, trigger_event, source_type, source_id,
        outcome, engine, trigger_payload, started_at, finished_at, detail, run_state)
      values ('${org}', '${rule}', '${name}', 'object_event', 'task', '${missingTask}', 'failed', 'graph_v2', '${event}',
        now(), now(), 'forbidden: the workflow''s owner may not do this.', '{"steps":{},"stepsTaken":1,"depth":0}')
      returning id::text`);
    sql(`insert into workflow_execution_step (execution_id, organization_id, position, step_id, step_kind, status, input, output, error, started_at, finished_at)
      values ('${run}', '${org}', 0, 'trigger', 'trigger', 'succeeded', null, '{"verb":"updated"}', null, now(), now()),
             ('${run}', '${org}', 1, 'send', 'action', 'failed', '{"priority":"high"}', null,
              'forbidden: the workflow''s owner may not do this.', now(), now())`);
    const number = sql(`select run_number from workflow_execution where id = '${run}'`);
    try {
      await signIn(page, "admin");
      await page.goto("/workflows");
      const failures = page.getByRole("table", { name: "Recent failures across workflows" });
      const row = failures.getByRole("row").filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`Run #${number}`);
      await expect(row).toContainText("Action send");
      await expect(row).toContainText("forbidden: the workflow's owner may not do this.");
      await axe(page, "/workflows with failures");

      const retry = row.getByRole("button", { name: `Retry from this step: Run #${number} Action send` });
      await retry.focus();
      await page.keyboard.press("Enter");
      const started = row.getByRole("link", { name: /^Open run #\d+$/ });
      await expect(started).toBeVisible({ timeout: 30_000 });
      expect(sql(`select count(*) from workflow_execution where retry_of = '${run}'`)).toBe("1");
      await started.click();
      await expect(page.getByRole("link", { name: `Retries run #${number}` })).toBeVisible();

      // The workflow's own page lists the failures and filters its history.
      await page.goto(`/workflows/${rule}`);
      await expect(page.getByRole("table", { name: "Failures" }).getByRole("row").filter({ hasText: `Run #${number}` })).toHaveCount(1);
      await page.getByLabel("Show").selectOption("failed");
      await page.waitForURL(/outcome=failed/);
      const history = page.getByRole("table", { name: "Run history" });
      await expect(history.getByRole("row").filter({ hasText: "Succeeded" })).toHaveCount(0);
      await expect(history.getByRole("row").filter({ hasText: `Run #${number}` })).toHaveCount(1);
    } finally {
      sql(`delete from workflow_rule where id = '${rule}'`);
      sql(`delete from workflow_execution where rule_id is null and rule_name = '${quote(name)}'`);
    }
  });
});
