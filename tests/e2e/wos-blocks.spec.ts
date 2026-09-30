import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS editor persistence (M4c, epic #199): the editor's Yjs state is
 * saved with the document, `block` rows are derived from it on every save,
 * and a document saved as JSON only (before M4c, or converted from plain
 * text) opens and gains Yjs state on its next edit.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

/** A click at the far right of a one-line block puts the caret after its last character. */
async function caretAtEnd(block: Locator) {
  const box = await block.boundingBox();
  if (!box) throw new Error("block not visible");
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

async function newPage(page: Page, title: string): Promise<string> {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  return page.url().split("/").pop()!;
}

test("saving stores the Yjs state and derives block rows", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Blocks ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("## Plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Book the hall");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Before Friday");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });

  const stored = sql(
    `select (yjs_state is not null)::text || '|' || version from public.editor_document where object_id = '${pageId}';`,
  );
  expect(stored.split("|")[0]).toBe("true");
  const rows = sql(
    `select string_agg(type || ':' || depth || ':' || text, ',' order by position) from public.block where object_id = '${pageId}';`,
  );
  expect(rows).toContain("heading:0:Plan");
  expect(rows).toContain("bulletListItem:0:Book the hall");
  expect(rows).toContain("bulletListItem:1:Before Friday");

  // Reloaded from the Yjs state: same document, nesting included.
  await page.reload();
  const reloaded = page.getByRole("textbox", { name: "Document content" });
  await expect(reloaded.locator("h2", { hasText: "Plan" })).toBeVisible({ timeout: 30_000 });
  await expect(reloaded.getByText("Before Friday")).toBeVisible();

  // Editing again replaces the rows.
  await caretAtEnd(reloaded.locator("[data-content-type='heading']"));
  await page.keyboard.type(" for June");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(() => sql(`select text from public.block where object_id = '${pageId}' and type = 'heading';`))
    .toBe("Plan for June");
});

test("a document saved as JSON only opens and gains Yjs state on its next edit", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Legacy ${Date.now()}`);
  sql(`
    insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
    select p.id, 'page', p.organization_id, p.created_by,
      '{"version":1,"blocks":[{"type":"paragraph","content":[{"type":"text","text":"Converted from plain text"}]}]}'::jsonb,
      'Converted from plain text'
    from public.page p where p.id = '${pageId}'
    on conflict (object_id) do nothing;`);
  expect(sql(`select (yjs_state is null)::text from public.editor_document where object_id = '${pageId}';`)).toBe("true");

  await page.reload();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Converted from plain text", { timeout: 30_000 });
  await caretAtEnd(editor.locator("[data-content-type='paragraph']").first());
  await page.keyboard.type(", now edited");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select (yjs_state is not null)::text from public.editor_document where object_id = '${pageId}';`)).toBe("true");
  expect(sql(`select text from public.block where object_id = '${pageId}' order by position limit 1;`)).toBe(
    "Converted from plain text, now edited",
  );
});
