import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Synced blocks and button blocks (U5b, switch wos_editor). A synced block
 * is kept once and shown on several pages; a reader who cannot open its
 * source gets a request-access state instead of its content. A button runs
 * a registered action after confirming, and the run is a change set that
 * can be undone.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor', 'wos_objects') and organization_id is null;`);

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

async function openEditor(page: Page) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  return editor;
}

/** Opens the source's edit dialog, replaces its text, and saves. */
async function editSynced(page: Page, text: string) {
  await page.getByRole("button", { name: "Edit synced content" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit synced content" });
  await expect(dialog).toBeVisible();
  const content = dialog.getByRole("textbox", { name: "Synced content" });
  await expect(content).toBeVisible({ timeout: 30_000 });
  await content.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test("a synced block updates its copy on another page [switches on]", async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  await signIn(page, "staff");

  // The source: a new synced block on page A, written in its edit dialog.
  const sourcePage = await newPage(page, `Synced source ${stamp}`);
  await openEditor(page);
  await slash(page, "synced", /^Synced block\b/);
  await page.getByRole("button", { name: "New synced block" }).click();
  await expect(page.getByText("Empty synced block")).toBeVisible({ timeout: 30_000 });
  await editSynced(page, `Opening hours ${stamp}`);
  const source = page.locator("[data-synced-role='source']");
  await expect(source.getByRole("textbox", { name: "Synced content" })).toContainText(`Opening hours ${stamp}`, { timeout: 30_000 });
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  const syncedId = sql(`select id from public.synced_block where source_object_id = '${sourcePage}'`);
  expect(syncedId).toMatch(/^[0-9a-f-]{36}$/);

  // The copy: page B shows the same block, read-only, marked as synced.
  const copyPage = await newPage(page, `Synced copy ${stamp}`);
  await openEditor(page);
  await slash(page, "synced", /^Synced block\b/);
  await page.getByLabel("Search synced blocks").fill(`Opening hours ${stamp}`);
  await page.getByRole("button", { name: `Show “Opening hours ${stamp}”` }).click();
  const copy = page.locator("[data-synced-role='copy']");
  await expect(copy.getByRole("textbox", { name: "Synced content" })).toContainText(`Opening hours ${stamp}`, { timeout: 30_000 });
  await expect(copy).toContainText("Synced");
  await expect(copy.getByRole("button", { name: "Edit synced content" })).toHaveCount(0);
  // Saved with the copy pointing at the block ("Saved" may still show from the insert).
  await expect
    .poll(() => sql(`select count(*) from public.block where object_id = '${copyPage}' and props->>'syncedBlockId' = '${syncedId}'`), {
      timeout: 30_000,
    })
    .toBe("1");

  // Editing the source writes through; the copy shows it on its next load.
  await page.goto(`/pages/${sourcePage}`);
  await expect(page.getByText("Shown on 2 pages")).toBeVisible({ timeout: 30_000 });
  await editSynced(page, `Closed on Mondays ${stamp}`);
  await expect.poll(() => sql(`select content::text like '%Closed on Mondays ${stamp}%' from public.synced_block where id = '${syncedId}'`)).toBe("t");

  await page.goto(`/pages/${copyPage}`);
  const reloaded = page.locator("[data-synced-role='copy']");
  await expect(reloaded.getByRole("textbox", { name: "Synced content" })).toContainText(`Closed on Mondays ${stamp}`, { timeout: 30_000 });
  await expect(reloaded).not.toContainText(`Opening hours ${stamp}`);
});

test("a reader without access sees a request-access state [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  // The source is the staff member's private page; the copy sits on a
  // workspace page everyone in the organization can open.
  const privatePage = sql(`insert into public.page (organization_id, visibility, created_by, title)
    values ('${org}', 'private', '${STAFF}', 'Private source ${stamp}') returning id`);
  const syncedId = sql(`insert into public.synced_block (organization_id, source_object_id, source_object_type, source_block_id, created_by, content)
    values ('${org}', '${privatePage}', 'page', 'src-${stamp}', '${STAFF}',
      '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Salary bands ${stamp}"}]}]}'::jsonb) returning id`);
  const sharedPage = sql(`insert into public.page (organization_id, visibility, created_by, title)
    values ('${org}', 'workspace', '${STAFF}', 'Shared copy ${stamp}') returning id`);
  sql(`insert into public.editor_document (object_id, object_type, organization_id, created_by, content)
    values ('${sharedPage}', 'page', '${org}', '${STAFF}',
      '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Before the copy"}]},
        {"type":"syncedBlock","props":{"syncedBlockId":"${syncedId}","role":"copy"}}]}'::jsonb)`);

  await signIn(page, "owner");
  await page.goto(`/pages/${sharedPage}`);
  await expect(page.getByText("Before the copy")).toBeVisible({ timeout: 30_000 });
  const access = page.getByTestId("synced-access");
  await expect(access).toContainText("This synced block comes from a page you can't open.", { timeout: 30_000 });
  await expect(page.getByText(`Salary bands ${stamp}`)).toHaveCount(0);

  await access.getByRole("button", { name: "Request access" }).click();
  await expect(access).toContainText("Access requested.", { timeout: 15_000 });
  const owner = sql(`select id from public.user_profile where email = 'qa-owner@example.com'`);
  expect(sql(`select status from public.synced_block_access_request where synced_block_id = '${syncedId}' and requester_id = '${owner}'`)).toBe(
    "requested",
  );

  // Pending after a reload, and still no content.
  await page.reload();
  await expect(page.getByTestId("synced-access")).toContainText("Access requested.", { timeout: 30_000 });
  await expect(page.getByText(`Salary bands ${stamp}`)).toHaveCount(0);
});

test("a button creates a task after confirming and records a change set [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  sql(`
    with p as (insert into public.program (organization_id, name, slug, created_by)
      values ('${org}', 'Button ${stamp}', 'button-${stamp}', '${STAFF}') returning id)
    insert into public.project (organization_id, program_id, name, owner_id, created_by)
    select '${org}', p.id, 'Button ${stamp}', '${STAFF}', '${STAFF}' from p;`);

  await signIn(page, "staff");
  const pageId = await newPage(page, `Button ${stamp}`);
  await openEditor(page);
  await slash(page, "button", /^Button\b/);
  await page.getByLabel("Button label").fill(`Start intake ${stamp}`);
  await page.getByLabel("Action", { exact: true }).selectOption("task.create");
  await page.getByLabel("Task title").fill(`Call the donor ${stamp}`);
  await page.getByLabel("Project", { exact: true }).selectOption({ label: `Button ${stamp}` });
  await page.getByRole("button", { name: "Save button" }).click();
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });

  // Asks first; cancelling runs nothing.
  const run = page.getByRole("button", { name: `Start intake ${stamp}` });
  await run.click();
  const confirm = page.getByRole("dialog", { name: `Run “Start intake ${stamp}”?` });
  await expect(confirm).toContainText(`This creates the task “Call the donor ${stamp}”.`);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(sql(`select count(*) from public.task where title = 'Call the donor ${stamp}'`)).toBe("0");

  await run.click();
  await page.getByRole("dialog", { name: `Run “Start intake ${stamp}”?` }).getByRole("button", { name: "Run" }).click();
  const result = page.getByTestId("button-result");
  await expect(result).toContainText(`Task “Call the donor ${stamp}” created.`, { timeout: 30_000 });

  const taskId = sql(`select id from public.task where title = 'Call the donor ${stamp}'`);
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(sql(`select source_type || ':' || source_id from public.task where id = '${taskId}'`)).toBe(`page:${pageId}`);
  const changeSet = sql(`select s.id from public.change_set s join public.change_set_item i on i.change_set_id = s.id
    where s.action_key = 'task.create' and i.object_id = '${taskId}' and s.actor_id = '${STAFF}'`);
  expect(changeSet).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number(sql(`select count(*) from public.object_event where object_id = '${taskId}' and verb = 'created'`))).toBeGreaterThan(0);

  // Undo reverses the change set: the task is archived.
  await result.getByRole("button", { name: "Undo" }).click();
  await expect(result).toContainText("Undone.", { timeout: 15_000 });
  await expect.poll(() => sql(`select (archived_at is not null)::text from public.task where id = '${taskId}'`)).toBe("true");
});
