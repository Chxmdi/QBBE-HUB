import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Progressive structure (M6, epic #199): selected lines turn into tasks or a
 * page with the original text kept and linked, and a line that names a person
 * and a date gets a quiet "Make a task" margin icon, which can be switched off.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

function makeProject(stamp: number): string {
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  return sql(`
    with p as (insert into public.program (organization_id, name, slug, created_by)
      values ('${org}', 'Progressive ${stamp}', 'progressive-${stamp}', '${STAFF}') returning id)
    insert into public.project (organization_id, program_id, name, owner_id, created_by)
    select '${org}', p.id, 'Progressive ${stamp}', '${STAFF}', '${STAFF}' from p returning id;`);
}

async function newPage(page: Page, title: string, button = "New page"): Promise<string> {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: button, exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: /Page title|Titre de la page/ });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  return page.url().split("/").pop()!;
}

test("selected lines turn into tasks and into a page, keeping the text", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  makeProject(stamp);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Turn into ${stamp}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type(`- Book the hall ${stamp}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Order chairs ${stamp}`);
  // Both lines are list items before the selection starts.
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: `Book the hall ${stamp}` })).toBeVisible();
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: `Order chairs ${stamp}` })).toBeVisible();

  // Select both list items and turn them into tasks.
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+/");
  await page.getByRole("dialog", { name: "Block menu" }).getByRole("button", { name: "Turn into tasks…" }).click();
  const turn = page.getByRole("dialog", { name: "Turn into tasks" });
  await expect(turn).toContainText(`Book the hall ${stamp}`);
  await expect(turn).toContainText(`Order chairs ${stamp}`);
  await turn.getByLabel("Project for the new task").selectOption({ label: `Progressive ${stamp}` });
  await turn.getByRole("button", { name: "Create 2 tasks" }).click();
  await expect(page.getByRole("checkbox", { name: `Mark “Book the hall ${stamp}” done` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: `Mark “Order chairs ${stamp}” done` })).toBeVisible();
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: `Book the hall ${stamp}` })).toBeVisible();
  expect(sql(`select count(*) from public.task where title in ('Book the hall ${stamp}', 'Order chairs ${stamp}')`)).toBe("2");

  // A paragraph turned into a page: a new page inside this one, linked here.
  await editor.locator("[data-content-type]").last().click();
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Venue ideas ${stamp}`);
  await page.keyboard.press("Control+/");
  await page.getByRole("dialog", { name: "Block menu" }).getByRole("button", { name: "Turn into a page" }).click();
  const link = editor.getByRole("link", { name: `Venue ideas ${stamp}` });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator("[data-content-type='paragraph']", { hasText: `Venue ideas ${stamp}` })).toBeVisible();
  const child = sql(`select id from public.page where parent_page_id = '${pageId}' and title = 'Venue ideas ${stamp}'`);
  expect(child).toMatch(/^[0-9a-f-]{36}$/);
  expect(sql(`select content_text from public.editor_document where object_id = '${child}'`)).toBe(`Venue ideas ${stamp}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/pages/${child}$`));
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(`Venue ideas ${stamp}`, { timeout: 30_000 });
});

test("a line naming a person and a date offers a quiet Make-a-task icon", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  makeProject(stamp);
  await signIn(page, "staff");
  const suggestPageId = await newPage(page, `Suggest ${stamp}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  const line = `QA Owner to send the minutes ${stamp} tomorrow`;
  await page.keyboard.type(line);

  const icon = page.getByRole("button", { name: `Make a task: ${line}` });
  await expect(icon).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Accessible with the icon showing. Scanned from the top of the window: when
  // the window has scrolled, the sticky top bar covers part of a sidebar link
  // and target-size reports that overlap instead of anything on this screen.
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(icon).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 120)} — ${n.failureSummary ?? ""}`)),
  ).toEqual([]);

  await icon.click();
  const dialog = page.getByRole("dialog", { name: "Make a task" });
  await expect(dialog).toContainText("QA Owner");
  const tomorrow = sql(`select to_char((now() at time zone 'America/Toronto')::date + 1, 'YYYY-MM-DD')`);
  await expect(dialog.getByLabel("Due date")).toHaveValue(tomorrow);
  await dialog.getByLabel("Project for the new task").selectOption({ label: `Progressive ${stamp}` });
  await dialog.getByRole("button", { name: "Create the task" }).click();
  await expect(page.getByRole("checkbox", { name: `Mark “${line}” done` })).toBeVisible({ timeout: 30_000 });
  expect(sql(`select assignee_id || '|' || due_at from public.task where title = '${line}'`)).toBe(`${OWNER}|${tomorrow}`);
  await expect(page.getByRole("button", { name: `Make a task: ${line}` })).toHaveCount(0);

  // Switched off, the icons go; the choice survives a reload.
  await editor.locator("[data-content-type]").last().click();
  await page.keyboard.press("Enter");
  const second = `QA Owner books the hall ${stamp} by Friday`;
  await page.keyboard.type(second);
  await expect(page.getByRole("button", { name: `Make a task: ${second}` })).toBeVisible({ timeout: 15_000 });
  const toggle = page.getByRole("switch", { name: "Task suggestions" });
  await toggle.uncheck();
  await expect(page.getByRole("button", { name: `Make a task: ${second}` })).toHaveCount(0);
  // The line must be saved before the reload, or it will not be there to suggest on.
  await expect
    .poll(() => sql(`select position('${second}' in content_text) > 0 from public.editor_document where object_id = '${suggestPageId}'`), {
      timeout: 30_000,
    })
    .toBe("t");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Task suggestions" })).not.toBeChecked({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: `Make a task: ${second}` })).toHaveCount(0);
  await page.getByRole("switch", { name: "Task suggestions" }).check();
  await expect(page.getByRole("button", { name: `Make a task: ${second}` })).toBeVisible({ timeout: 15_000 });
});

test("the suggestion reads French date phrases", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await newPage(page, `Suggestion ${stamp}`, "Nouvelle page");
  const editor = page.getByRole("textbox", { name: "Contenu du document" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  const line = `QA Owner envoie le procès-verbal ${stamp} d’ici vendredi`;
  await page.keyboard.type(line);
  await expect(page.getByRole("button", { name: `Créer une tâche : ${line}` })).toBeVisible({ timeout: 15_000 });
});
