import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Task descriptions in the block editor (M4d, epic #199), behind the
 * `wos_editor` switch: a plain-text description opens converted, editing it
 * keeps task.description in step, and with the switch off the drawer shows
 * the plain field exactly as before.
 */

const setEditor = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key = 'wos_editor' and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.afterAll(() => setEditor(false));

async function createTask(page: Page, title: string): Promise<string> {
  await page.goto("/my-work?create=task");
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  const id = sql(`select id::text from task where title = '${title}' limit 1`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

async function caretAtEnd(block: Locator) {
  const box = await block.boundingBox();
  if (!box) throw new Error("block not visible");
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

test("a task description opens in the editor and stays in step with the task", async ({ page }) => {
  test.setTimeout(180_000);
  setEditor(true);
  await signIn(page, "owner");
  const title = `Described ${Date.now()}`;
  const taskId = await createTask(page, title);
  sql(`update public.task set description = E'Book the hall\\n\\nConfirm catering' where id = '${taskId}';`);

  await page.goto(`/my-work?task=${taskId}`);
  const drawer = page.getByRole("dialog").first();
  await expect(drawer.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
  const editor = drawer.getByRole("textbox", { name: "Description" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator("[data-content-type='paragraph']")).toHaveCount(3);
  await expect(editor).toContainText("Book the hall");
  await expect(editor).toContainText("Confirm catering");

  // Formatting in the editor; plain text on the task.
  await caretAtEnd(editor.locator("[data-content-type='paragraph']").last());
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Send invitations");
  await expect(drawer.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(() => sql(`select description from public.task where id = '${taskId}';`))
    .toBe("Book the hall\n\nConfirm catering\nSend invitations");
  expect(sql(`select string_agg(type, ',' order by position) from public.block where object_id = '${taskId}';`)).toBe(
    "paragraph,paragraph,paragraph,bulletListItem",
  );

  // A change made the old way replaces the document, and the drawer shows it.
  sql(`update public.task set description = 'Changed elsewhere' where id = '${taskId}';`);
  await page.reload();
  const reloaded = page.getByRole("dialog").first().getByRole("textbox", { name: "Description" });
  await expect(reloaded).toContainText("Changed elsewhere", { timeout: 30_000 });
  await expect(reloaded).not.toContainText("Send invitations");
});

test("with the editor switch off, the drawer keeps the plain description field [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  setEditor(false);
  await signIn(page, "owner");
  const title = `Plain ${Date.now()}`;
  const taskId = await createTask(page, title);
  sql(`update public.task set description = 'Plain words' where id = '${taskId}';`);
  await page.goto(`/my-work?task=${taskId}`);
  const drawer = page.getByRole("dialog").first();
  await expect(drawer.getByLabel("Description")).toHaveValue("Plain words", { timeout: 30_000 });
  await expect(drawer.getByRole("textbox", { name: "Description" })).toHaveJSProperty("tagName", "TEXTAREA");
});
