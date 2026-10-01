import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Semantic blocks (M5, epic #199): a task block is the task itself, and
 * decision, person, status, query and library-file blocks show live data.
 * Deleting a task block asks whether to archive the task.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

async function newPage(page: Page, title: string): Promise<string> {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  return page.url().split("/").pop()!;
}

async function slash(page: Page, words: string, option: RegExp) {
  await page.keyboard.type(`/${words}`);
  await expect(page.getByRole("option", { name: option, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
}

test("semantic blocks: task, person, status, query, decision and library file", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  const project = sql(`
    with p as (insert into public.program (organization_id, name, slug, created_by)
      values ('${org}', 'Semantic ${stamp}', 'semantic-${stamp}', '${STAFF}') returning id)
    insert into public.project (organization_id, program_id, name, owner_id, created_by)
    select '${org}', p.id, 'Semantic ${stamp}', '${STAFF}', '${STAFF}' from p returning id;`);
  sql(`insert into public.task (organization_id, project_id, title, created_by, assignee_id, due_at)
       values ('${org}', '${project}', 'Overdue report ${stamp}', '${STAFF}', '${STAFF}', current_date - 3);`);
  sql(`insert into public.decision (organization_id, project_id, title, decided_by)
       values ('${org}', '${project}', 'Hold the gala in May ${stamp}', '${STAFF}');`);
  sql(`insert into public.document (organization_id, title, kind, url, owner_id, created_by, visibility)
       values ('${org}', 'Venue contract ${stamp}', 'link', 'https://drive.google.com/file/d/abc', '${STAFF}', '${STAFF}', 'organization');`);

  await signIn(page, "staff");
  const pageId = await newPage(page, `Semantic ${stamp}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();

  // Task: created from the block, and the block is that task.
  await slash(page, "task", /^Task\b/);
  await page.getByLabel("Search tasks").fill(`Order chairs ${stamp}`);
  await page.getByLabel("Project for the new task").selectOption({ label: `Semantic ${stamp}` });
  await page.getByRole("button", { name: `Create task “Order chairs ${stamp}”` }).click();
  const done = page.getByRole("checkbox", { name: `Mark “Order chairs ${stamp}” done` });
  await expect(done).toBeVisible({ timeout: 30_000 });
  const taskId = sql(`select id from public.task where title = 'Order chairs ${stamp}'`);
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
  await done.check();
  await expect.poll(() => sql(`select status from public.task where id = '${taskId}'`)).toBe("completed");

  // Person.
  await page.keyboard.press("Escape");
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "person", /^Person\b/);
  await page.getByLabel("Search people").fill("QA Owner");
  await page.getByRole("button", { name: "Choose QA Owner" }).click();
  await expect(editor.getByRole("link", { name: "QA Owner" })).toBeVisible();

  // Status with a note.
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "status", /^Status\b/);
  await page.getByLabel("Status", { exact: true }).selectOption("at_risk");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("at_risk");

  // Query: overdue tasks, run as the viewer.
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "task list", /^Task list\b/);
  await page.getByLabel("Show", { exact: true }).selectOption("overdue");
  await expect(page.getByRole("heading", { name: "Overdue tasks" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Overdue report ${stamp}` })).toBeVisible({ timeout: 30_000 });

  // Query again, this time decisions: the same block runs any type the query engine knows.
  await page.keyboard.press("Escape");
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "task list", /^Task list\b/);
  await page.getByLabel("Show", { exact: true }).last().selectOption("recent_decisions");
  await expect(page.getByRole("heading", { name: "Recent decisions" })).toBeVisible();
  const decisionRow = page.getByRole("link", { name: `Hold the gala in May ${stamp}` });
  await expect(decisionRow.first()).toBeVisible({ timeout: 30_000 });
  await expect(decisionRow.first()).toHaveAttribute("href", `/projects/${project}`);
  await expect(page.getByText(/^decided /).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Decision.
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "decision", /^Decision\b/);
  await page.getByLabel("Search decisions").fill(`gala in May ${stamp}`);
  await page.getByRole("button", { name: `Choose Hold the gala in May ${stamp}` }).click();
  // Shown twice now: in the decision block and in the decisions query block above it.
  await expect(editor.getByText(`Hold the gala in May ${stamp}`)).toHaveCount(2);

  // Library file.
  await editor.locator("[data-content-type]").last().click();
  await slash(page, "library file", /^Library file\b/);
  await page.getByLabel("Search files").fill(`Venue contract ${stamp}`);
  await page.getByRole("button", { name: `Choose Venue contract ${stamp}` }).click();
  await expect(page.getByRole("button", { name: `Open Venue contract ${stamp}` })).toBeVisible();

  // Saved, with block rows pointing at the objects.
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(() => sql(`select count(*) from public.block where object_id = '${pageId}' and referenced_object_id is not null`))
    .toBe("4");
  expect(sql(`select count(*) from public.block where object_id = '${pageId}' and referenced_object_id = '${taskId}'`)).toBe("1");

  // Accessible, scanned from the top.
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)} — ${n.failureSummary ?? ""}`)),
  ).toEqual([]);

  // After a reload the blocks still show their objects.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `Mark “Order chairs ${stamp}” done` })).toBeChecked({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: `Overdue report ${stamp}` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Recent decisions" })).toBeVisible();
  await expect(page.getByRole("link", { name: `Hold the gala in May ${stamp}` }).first()).toBeVisible({ timeout: 30_000 });
});

test("deleting a task block asks whether to archive the task", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  sql(`
    with p as (insert into public.program (organization_id, name, slug, created_by)
      values ('${org}', 'Delete ${stamp}', 'delete-${stamp}', '${STAFF}') returning id)
    insert into public.project (organization_id, program_id, name, owner_id, created_by)
    select '${org}', p.id, 'Delete ${stamp}', '${STAFF}', '${STAFF}' from p;`);
  await signIn(page, "staff");
  await newPage(page, `Delete task block ${stamp}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Before the task");
  await page.keyboard.press("Enter");
  await slash(page, "task", /^Task\b/);
  await page.getByLabel("Search tasks").fill(`Throwaway ${stamp}`);
  await page.getByLabel("Project for the new task").selectOption({ label: `Delete ${stamp}` });
  await page.getByRole("button", { name: `Create task “Throwaway ${stamp}”` }).click();
  await expect(page.getByRole("checkbox", { name: `Mark “Throwaway ${stamp}” done` })).toBeVisible({ timeout: 30_000 });
  const taskId = sql(`select id from public.task where title = 'Throwaway ${stamp}'`);

  // Remove it with the block menu from the paragraph above: move the task up
  // over the paragraph, then delete the paragraph's neighbour from the menu.
  await editor.locator("[data-content-type='paragraph']").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Control+/");
  const menu = page.getByRole("dialog", { name: "Block menu" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Delete block" }).click();
  await expect(page.getByRole("checkbox", { name: `Mark “Throwaway ${stamp}” done` })).toHaveCount(0);

  const ask = page.getByRole("dialog", { name: "Also archive the task?" });
  await expect(ask).toBeVisible({ timeout: 15_000 });
  await expect(ask).toContainText(`Throwaway ${stamp}`);
  await ask.getByRole("button", { name: "Archive the task" }).click();
  await expect.poll(() => sql(`select (archived_at is not null)::text from public.task where id = '${taskId}'`)).toBe("true");
});
