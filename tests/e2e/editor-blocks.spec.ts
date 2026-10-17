import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { useClipboard } from "./clipboard";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * The block handle menu, multi-block selection and keyboard moves (U4), on a
 * page behind the `wos_pages` and `wos_editor` switches. Each test's page is
 * created straight in the database, with its lines already written.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

/** A workspace page owned by staff, holding one paragraph per line. */
function makePage(title: string, lines: string[]): string {
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}' limit 1`);
  const pageId = sql(
    `insert into public.page (organization_id, title, created_by) values ('${org}', '${title}', '${STAFF}') returning id;`,
  );
  const content = JSON.stringify({
    version: 1,
    blocks: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] })),
  });
  sql(`
    insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
    values ('${pageId}', 'page', '${org}', '${STAFF}', '${content}'::jsonb, '${lines.join("\n")}');`);
  return pageId;
}

async function openPage(page: Page, pageId: string): Promise<Locator> {
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

const order = (editor: Locator) =>
  editor.locator("[data-content-type='paragraph']").evaluateAll((els) => els.map((el) => el.textContent?.trim() ?? ""));

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

/** Hovers the line so its handle shows, then opens the handle menu. */
async function openHandle(page: Page, line: Locator): Promise<Locator> {
  await line.hover();
  const grip = page.getByRole("button", { name: "Block actions" });
  await expect(grip).toBeVisible();
  await grip.click();
  const menu = page.getByRole("menu").filter({ has: page.getByRole("menuitem", { name: "Duplicate" }) });
  await expect(menu).toBeVisible();
  return menu;
}

test("the handle menu duplicates and recolours a block [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Handle ${stamp}`, [`Agenda ${stamp}`, `Budget ${stamp}`, `Minutes ${stamp}`]);
  const editor = await openPage(page, pageId);
  const budget = editor.locator("[data-content-type='paragraph']", { hasText: `Budget ${stamp}` });

  let menu = await openHandle(page, budget);
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => order(editor)).toEqual([`Agenda ${stamp}`, `Budget ${stamp}`, `Budget ${stamp}`, `Minutes ${stamp}`]);

  // Colour: a submenu reached from the menu, with the keyboard.
  menu = await openHandle(page, budget.first());
  await menu.getByRole("menuitem", { name: "Color" }).focus();
  await page.keyboard.press("ArrowRight");
  const colors = page.getByRole("menu").filter({ has: page.getByRole("menuitemcheckbox", { name: "Red" }).or(page.getByRole("menuitem", { name: "Red" })) });
  await expect(colors).toBeVisible();
  await colors.getByRole("menuitemcheckbox", { name: "Red" }).or(colors.getByRole("menuitem", { name: "Red" })).first().click();
  await expect(editor.locator("[data-content-type='paragraph'][data-text-color='red']", { hasText: `Budget ${stamp}` })).toHaveCount(1);

  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select count(*) from public.block where object_id = '${pageId}' and text = 'Budget ${stamp}'`)).toBe("2");

  // Copy link names the block on this page.
  const clipboard = await useClipboard(page);
  menu = await openHandle(page, editor.locator("[data-content-type='paragraph']", { hasText: `Agenda ${stamp}` }));
  await menu.getByRole("menuitem", { name: "Copy link" }).click();
  const copied = await clipboard.read();
  expect(copied).toMatch(new RegExp(`/pages/${pageId}#block-[0-9a-f-]+$`));

  // Accessible with the handle menu open, in both themes.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    menu = await openHandle(page, editor.locator("[data-content-type='paragraph']", { hasText: `Minutes ${stamp}` }));
    expect(await seriousAxe(page), `${theme}: handle menu open`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
});

test("shift-arrow selects three blocks and deletes them [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const lines = ["One", "Two", "Three", "Four", "Five"].map((word) => `${word} ${stamp}`);
  const pageId = makePage(`Select ${stamp}`, lines);
  const editor = await openPage(page, pageId);

  await editor.locator("[data-content-type='paragraph']", { hasText: lines[1] }).click();
  await page.keyboard.press("Home");
  await expect(async () => {
    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.getByRole("toolbar", { name: "Selected blocks" })).toContainText("3 blocks selected", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  const bar = page.getByRole("toolbar", { name: "Selected blocks" });
  // The bar is reachable from the keyboard: Alt+F10 moves into it.
  await page.keyboard.press("Alt+F10");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".qbbe-bulk-bar")))).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await seriousAxe(page), "selection bar open").toEqual([]);
  await bar.getByRole("button", { name: "Delete" }).click();

  await expect.poll(() => order(editor)).toEqual([lines[0], lines[4]]);
  await expect(page.locator("#qbbe-editor-live")).toHaveText("3 blocks deleted.");
  await expect(bar).toHaveCount(0);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("alt-arrow moves a selection and the drop target is announced [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const lines = ["Alpha", "Bravo", "Charlie", "Delta"].map((word) => `${word} ${stamp}`);
  const pageId = makePage(`Move ${stamp}`, lines);
  const editor = await openPage(page, pageId);

  // Select Alpha and Bravo, then move them down one place.
  await editor.locator("[data-content-type='paragraph']", { hasText: lines[0] }).click();
  await page.keyboard.press("Home");
  await expect(async () => {
    await page.keyboard.press("Shift+ArrowDown");
    await expect(page.getByRole("toolbar", { name: "Selected blocks" })).toContainText("2 blocks selected", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(editor)).toEqual([lines[2], lines[0], lines[1], lines[3]]);
  await expect(page.locator("#qbbe-editor-live")).toHaveText(`Moved below “${lines[2]}”.`);
  // The rows the blocks landed on are highlighted, and the selection is kept.
  await expect(page.getByTestId("drop-target")).toHaveCount(2);
  await expect(page.getByRole("toolbar", { name: "Selected blocks" })).toContainText("2 blocks selected");

  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => order(editor)).toEqual(lines);
  await expect(page.locator("#qbbe-editor-live")).toHaveText("Already at the top.");

  // Escape clears the selection and its highlight.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Selected blocks" })).toHaveCount(0);
  await expect(page.getByTestId("drop-target")).toHaveCount(0);
  await expect(page.locator("#qbbe-editor-live")).toHaveText("Selection cleared.");

  // A single block moves with Alt+Arrow too.
  await editor.locator("[data-content-type='paragraph']", { hasText: lines[3] }).click();
  // The editor reads a click's caret on the browser's next selection event, so
  // a key pressed in the same instant would still act on the earlier block.
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? null))
    .toBe(lines[3]);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => order(editor)).toEqual([lines[0], lines[1], lines[3], lines[2]]);
  await expect(page.locator("#qbbe-editor-live")).toHaveText(`Moved above “${lines[2]}”.`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select string_agg(text, ',' order by position) from public.block where object_id = '${pageId}'`)).toBe(
    [lines[0], lines[1], lines[3], lines[2]].join(","),
  );
});
