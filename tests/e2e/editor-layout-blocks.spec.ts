import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Layout blocks (U5a) behind `wos_editor`: a column list laid out as a grid
 * that stacks on narrow screens, and a table of contents whose links follow
 * the page's headings and can be reached and followed from the keyboard.
 * The derived `block` rows keep the columns' nesting.
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

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
}

test("two columns and a table of contents render and read from the keyboard [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const title = `Layout ${Date.now()}`;
  const pageId = sql(
    `insert into public.page (organization_id, visibility, created_by, title)
     select m.organization_id, 'workspace', p.id, '${title}'
     from public.user_profile p join public.organization_membership m on m.user_id = p.id
     where p.email = 'qa-staff@example.com' returning id;`,
  );
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();

  // A heading, then the table of contents from the slash menu. Writing
  // continues below the table.
  await page.keyboard.type("# Overview");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table of");
  await expect(page.getByRole("option", { name: /^Table of contents/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const toc = editor.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();
  await expect(toc.getByRole("link", { name: "Overview" })).toBeVisible();

  // Two columns from the slash menu; the cursor lands in the first column.
  await page.keyboard.type("/columns");
  await expect(page.getByRole("option", { name: /^Columns/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const columns = editor.locator(".node-columnList + .bn-block-group > .bn-block-outer");
  await expect(columns).toHaveCount(2);
  await page.keyboard.type("## Left");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Left text");
  await expect(columns.nth(0).locator("h2", { hasText: "Left" })).toBeVisible();

  // The arrow keys walk into the second column.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("## Right");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Right text");
  await expect(columns.nth(1).locator("h2", { hasText: "Right" })).toBeVisible();
  await expect(columns.nth(1).getByText("Right text")).toBeVisible();
  // Shift+Tab does not pull a block out of its column.
  await page.keyboard.press("Shift+Tab");
  await expect(columns).toHaveCount(2);
  await expect(columns.nth(1).getByText("Right text")).toBeVisible();

  // Side by side, as a grid.
  const left = await box(columns.nth(0));
  const right = await box(columns.nth(1));
  expect(Math.abs(left.y - right.y)).toBeLessThan(2);
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
  await expect(editor.locator(".node-columnList + .bn-block-group")).toHaveCSS("display", "grid");

  // The table of contents follows the headings, nested by level, and each
  // link points at the heading block's own anchor.
  await expect(toc.getByRole("link")).toHaveText(["Overview", "Left", "Right"]);
  await expect(toc.locator("ol > li > ol > li > a")).toHaveText(["Left", "Right"]);
  const anchors = await editor.locator("[data-content-type='heading']").evaluateAll((els) =>
    els.map((el) => `#${el.id}|block-${el.closest<HTMLElement>(".bn-block-outer")?.dataset.id}`),
  );
  for (const pair of anchors) {
    const [id, expected] = pair.split("|");
    expect(id).toBe(`#${expected}`);
  }
  const hrefs = await toc.getByRole("link").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
  expect(hrefs).toEqual(anchors.map((pair) => pair.split("|")[0]));

  // From the keyboard: Down from the heading stops on the table, Enter moves
  // into its links, Tab walks them, Enter follows one to its heading.
  await caretAtEnd(editor.locator("h1", { hasText: "Overview" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveText("Overview");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Left");
  await page.keyboard.press("Enter");
  const leftHeading = columns.nth(0).locator("h2", { hasText: "Left" });
  await expect(leftHeading).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(hrefs[1]);
  await page.keyboard.press("End");
  await page.keyboard.type(" column");
  await expect(leftHeading).toHaveText("Left column");
  await expect(toc.getByRole("link", { name: "Left column" })).toBeVisible();

  // Escape returns from a link to the text.
  await caretAtEnd(editor.locator("h1", { hasText: "Overview" }));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(":focus")).toHaveText("Overview");
  await page.keyboard.press("Escape");
  await expect(editor).toBeFocused();

  // Saved: the derived rows keep the columns' nesting.
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(() => sql(`select string_agg(type || ':' || depth, ',' order by position) from public.block where object_id = '${pageId}';`))
    .toContain("tableOfContents:0,columnList:0,column:1,heading:2,paragraph:2,column:1,heading:2,paragraph:2");
  expect(sql(`select parent_block_id from public.block where object_id = '${pageId}' and type = 'column' limit 1;`)).toBe(
    sql(`select block_id from public.block where object_id = '${pageId}' and type = 'columnList';`),
  );

  // No serious accessibility finding, in either theme.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await seriousAxe(page), `${theme}`).toEqual([]);
  }

  // Under 640 px the columns stack.
  await page.setViewportSize({ width: 600, height: 900 });
  const leftNarrow = await box(columns.nth(0));
  const rightNarrow = await box(columns.nth(1));
  expect(rightNarrow.y).toBeGreaterThanOrEqual(leftNarrow.y + leftNarrow.height - 1);
  expect(Math.abs(leftNarrow.x - rightNarrow.x)).toBeLessThan(2);

  // Reloaded from the saved state: the same layout and the same links.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const again = page.getByRole("textbox", { name: "Document content" });
  await expect(again.locator(".node-columnList + .bn-block-group > .bn-block-outer")).toHaveCount(2, { timeout: 30_000 });
  await expect(again.getByRole("navigation", { name: "Table of contents" }).getByRole("link")).toHaveText([
    "Overview",
    "Left column",
    "Right",
  ]);
});
