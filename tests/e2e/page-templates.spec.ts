import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Page templates create real pages (V1-13, unit U8): the starter "Meeting
 * notes" template makes an editable page inside a chosen page with its
 * variables filled, and a volunteer, who cannot create a workspace page by
 * hand, cannot create one from a template either. Behind the `wos_pages`,
 * `wos_editor` and `wos_objects` switches (templates use the object layer's).
 */

const switches = (on: boolean) =>
  sql(
    `update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor', 'wos_objects') and organization_id is null;`,
  );

const meetingNotesId = () =>
  sql(`select id from public.template_v2 where scope = 'page' and created_by is null and name_en = 'Meeting notes' limit 1`);

/** Removes a page and what hangs off it (the API never hard-deletes; the test does). */
function removePage(id: string) {
  sql(`delete from public.editor_document where object_id = '${id}'; delete from public.page where id = '${id}';`);
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

test("Meeting notes creates an editable page in the chosen space with the variables filled [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff");
  const stamp = Date.now();
  const spaceTitle = `Team space ${stamp}`;
  const pageTitle = `Board meeting ${stamp}`;
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  const workspace = sidebar.getByRole("region", { name: "Workspace" });
  let spaceId = "";
  let pageId = "";

  try {
    // The space the page goes in: a workspace page made by hand.
    await page.goto("/pages");
    await sidebar.getByRole("button", { name: "New page", exact: true }).click();
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    spaceId = page.url().split("/").pop()!;
    const title = page.getByRole("textbox", { name: "Page title" });
    await title.fill(spaceTitle);
    await title.press("Enter");
    await expect(workspace.getByRole("link", { name: spaceTitle })).toBeVisible({ timeout: 30_000 });

    // New page from template, next to the New page button.
    await sidebar.getByRole("button", { name: "New page from template" }).click();
    const dialog = page.getByRole("dialog", { name: "New page from template" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Template").selectOption({ label: "Meeting notes" });
    await dialog.getByLabel("Where").selectOption({ label: `Inside ${spaceTitle}` });
    await dialog.getByLabel("Page title").fill(pageTitle);
    await dialog.getByLabel("Start date").fill("2031-03-03");
    await dialog.getByLabel("Program name").fill("Youth program");
    await dialog.getByLabel("Owner").fill("Jane Doe");
    await dialog.getByLabel("Period").fill("Fall 2031");
    await dialog.getByLabel("Due date").fill("2031-03-17");

    // The preview is the page the database will write.
    const preview = dialog.getByRole("region", { name: "What this creates" });
    await expect(preview.getByText("Program: Youth program · Led by Jane Doe · Period: Fall 2031")).toBeVisible();
    await expect(preview.getByText("Share the notes · Due 2031-03-04")).toBeVisible();
    await expect(preview.getByText("Follow up on the actions by 2031-03-17")).toBeVisible();

    await dialog.getByRole("button", { name: "Create page" }).click();
    await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    pageId = page.url().split("/").pop()!;
    expect(pageId).not.toBe(spaceId);

    // Inside the chosen space, titled, and open in the editor with the rendered blocks.
    await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(pageTitle, { timeout: 30_000 });
    await expect(page.getByRole("navigation", { name: "Page location" }).getByRole("link", { name: spaceTitle })).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator("h2", { hasText: "Agenda" })).toBeVisible();
    await expect(editor.getByText("Program: Youth program · Led by Jane Doe · Period: Fall 2031")).toBeVisible();
    await expect(editor.locator("[data-content-type='checkListItem']", { hasText: "Share the notes · Due 2031-03-04" })).toBeVisible();
    await expect(editor.locator("[data-content-type='checkListItem']", { hasText: "Follow up on the actions by 2031-03-17" })).toBeVisible();
    await expect(workspace.getByRole("link", { name: pageTitle })).toBeVisible();

    // What the database holds: parent, version 1, and derived blocks for search.
    expect(sql(`select parent_page_id::text || '|' || visibility from public.page where id = '${pageId}'`)).toBe(`${spaceId}|workspace`);
    expect(sql(`select version::text || '|' || (yjs_state is null)::text from public.editor_document where object_id = '${pageId}'`)).toBe("1|true");
    expect(sql(`select count(*) from public.block where object_id = '${pageId}' and type = 'checkListItem'`)).toBe("2");
  } finally {
    if (pageId) removePage(pageId);
    if (spaceId) removePage(spaceId);
  }
});

test("a volunteer cannot create a workspace page from a template [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "volunteer");
  const stamp = Date.now();
  const attempted = `Volunteer attempt ${stamp}`;

  // The pages sidebar offers volunteers no template button for the workspace.
  await page.goto("/pages");
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar.getByRole("button", { name: "New private page" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "New page from template" })).toHaveCount(0);

  // The template's own screen offers no workspace destination either.
  await page.goto(`/templates-v2/${meetingNotesId()}`);
  await expect(page.getByRole("heading", { name: "Meeting notes", level: 1 })).toBeVisible();
  const where = page.getByLabel("Where");
  await expect(where).toBeVisible();
  await expect(where.locator("option", { hasText: "Workspace (top level)" })).toHaveCount(0);

  // Even a forged choice is refused by the database, not just hidden by the screen.
  await where.evaluate((select: HTMLSelectElement) => {
    const option = document.createElement("option");
    option.value = "workspace";
    option.textContent = "Workspace (forged)";
    select.append(option);
  });
  await where.selectOption("workspace");
  await page.getByLabel("Page title").fill(attempted);
  await page.getByRole("button", { name: "Use template" }).click();
  await expect(page.getByRole("alert")).toHaveText("You cannot create a page there. Choose another place or ask an owner.", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/templates-v2\//);
  expect(sql(`select count(*) from public.page where title = '${attempted}'`)).toBe("0");
});
