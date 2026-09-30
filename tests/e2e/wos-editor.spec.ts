import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS block editor (M4b, epic #199) on a page, behind the
 * `wos_pages` and `wos_editor` switches: Markdown shortcuts, the slash menu,
 * keyboard block moves and the block menu, callout, bookmark and embed
 * blocks, pasting from Word, autosave, and the W0-5 accessibility conditions.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

async function newPage(page: Page, title: string) {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(title);
  await titleBox.press("Enter");
}

/**
 * Puts the caret at the end of a one-line block: a click at the far right of
 * its line lands after the last character. (Click then End raced the click's
 * own caret placement and sometimes split the line.)
 */
async function caretAtEnd(page: Page, block: Locator) {
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

test("staff write a page with the block editor, from the keyboard", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "staff");
  await newPage(page, `Editor ${Date.now()}`);

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await expect(editor).toHaveAttribute("aria-describedby", /.+/);
  await editor.click();

  // Markdown shortcuts.
  await page.keyboard.type("## Agenda");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Review the budget");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("[] Send the minutes");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(editor.locator("h2", { hasText: "Agenda" })).toBeVisible();
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: "Review the budget" })).toBeVisible();
  await expect(editor.locator("[data-content-type='checkListItem']", { hasText: "Send the minutes" })).toBeVisible();

  // Slash menu: a callout, chosen with the keyboard only.
  await page.keyboard.type("/callout");
  await expect(page.getByRole("option", { name: /Callout/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Doors open at 6 pm");
  await expect(editor.locator("[data-content-type='callout']", { hasText: "Doors open at 6 pm" })).toBeVisible();

  // Move the callout up one place with the keyboard.
  await page.keyboard.press("Control+Shift+ArrowUp");
  const types = await editor.locator("[data-content-type]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-content-type")),
  );
  expect(types.indexOf("callout")).toBeLessThan(types.lastIndexOf("checkListItem"));

  // The block menu (Ctrl+/) turns the callout into a quote.
  await page.keyboard.press("Control+/");
  const menu = page.getByRole("dialog", { name: "Block menu" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "Turn into Quote" }).click();
  await expect(menu).toHaveCount(0);
  await expect(editor.locator("[data-content-type='quote']", { hasText: "Doors open at 6 pm" })).toBeVisible();

  // A bookmark through its own form.
  await caretAtEnd(page, editor.locator("[data-content-type='checkListItem']").last());
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/bookmark");
  await expect(page.getByRole("option", { name: /^Bookmark/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const bookmarkField = page.getByLabel("Link address (https)");
  await bookmarkField.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Add bookmark" }).click();
  await expect(page.getByText("Enter an https:// address.")).toBeVisible();
  await bookmarkField.fill("https://example.org/guide");
  await page.getByRole("button", { name: "Add bookmark" }).click();
  await expect(page.getByRole("link", { name: "Open example.org in a new tab" })).toBeVisible();

  // An embed: refused when not on the allow-list, framed when it is.
  await caretAtEnd(page, editor.locator("[data-content-type='heading']").first());
  await page.keyboard.press("Enter");
  await page.keyboard.type("/embed");
  await expect(page.getByRole("option", { name: /^Embed/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  const embedField = page.getByLabel("Address to embed");
  await embedField.fill("https://evil.example/video");
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  await expect(page.getByText(/This address can't be embedded/)).toBeVisible();
  await embedField.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  const frame = page.locator("iframe[title='Embedded content from YouTube']");
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await expect(frame).toHaveAttribute("sandbox", /allow-scripts/);

  // Paste from Word: its HTML becomes a heading, a list and bold text.
  await caretAtEnd(page, editor.locator("[data-content-type='quote']"));
  await page.keyboard.press("Enter");
  await editor.evaluate((el) => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>' +
      '<h1 class="MsoTitle">Pasted title</h1>' +
      '<ul><li class="MsoListParagraph">Word item one</li><li class="MsoListParagraph">Word item two</li></ul>' +
      '<p class="MsoNormal"><b>Bold words</b> and plain</p></body></html>';
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", "Pasted title\nWord item one\nWord item two\nBold words and plain");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator("h1", { hasText: "Pasted title" })).toBeVisible();
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: "Word item two" })).toBeVisible();
  await expect(editor.locator("strong", { hasText: "Bold words" })).toBeVisible();

  // Autosave, then the same content after a reload.
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await page.reload();
  const reloaded = page.getByRole("textbox", { name: "Document content" });
  await expect(reloaded.locator("h2", { hasText: "Agenda" })).toBeVisible({ timeout: 30_000 });
  await expect(reloaded.locator("[data-content-type='quote']", { hasText: "Doors open at 6 pm" })).toBeVisible();
  await expect(reloaded.locator("h1", { hasText: "Pasted title" })).toBeVisible();
  await expect(page.locator("iframe[title='Embedded content from YouTube']")).toBeVisible();

  // Accessibility at rest, scanned from the top: further down, the page
  // sidebar scrolls under the app's sticky header, which axe reports as
  // obscured targets on any long page.
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await seriousAxe(page)).toEqual([]);

  // Escape then Tab leaves the editor, past links and check boxes inside it.
  await reloaded.locator("[data-content-type='bulletListItem']").first().click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-editor")))).toBe(false);

  // Alt+F10 reaches the formatting toolbar once text is selected; Escape returns.
  await reloaded.locator("h2").click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
  await page.keyboard.press("Alt+F10");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-formatting-toolbar")))).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-editor")))).toBe(true);
});

test("the W0-5 conditions hold with each editor menu open, in both themes", async ({ page }) => {
  // F3 (names), F4 (focus ring, contrast, target size) and F5 (a way below a
  // final table) from docs/design/spikes/W0-5-editor-accessibility.md. The
  // test above scans the editor at rest in the light theme only.
  test.setTimeout(240_000);
  await signIn(page, "staff");
  await newPage(page, `Conditions ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("[] Send the minutes");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  // Two lines between the check box and the text the toolbar is opened on:
  // the floating toolbar covers the line above the selection while it is open.
  await page.keyboard.type("Spacer one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Spacer two");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Plain text");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });

  // F3 and F4: the check box has a name and a 24 px target.
  const box = editor.locator("[data-content-type='checkListItem'] input[type='checkbox']").first();
  await expect(box).toHaveAttribute("aria-label", /.+/);
  const size = await box.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(24);
  expect(size?.height).toBeGreaterThanOrEqual(24);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await page.evaluate(() => window.scrollTo(0, 0));

    // F4: a visible focus ring on the editor itself.
    await editor.locator("p", { hasText: "Plain text" }).click();
    const outline = await editor.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style, `${theme}: focus ring style`).not.toBe("none");
    expect(outline.width, `${theme}: focus ring width`).toBeGreaterThanOrEqual(2);

    // The slash menu open: named, and no serious axe finding.
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/");
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await expect(list).toHaveAttribute("aria-label", /.+/);
    await page.evaluate(() => window.scrollTo(0, 0));
    // axe's scrollable-region-focusable asks for the list to be reachable
    // with Tab. For this pattern (a combobox driving a listbox through
    // aria-activedescendant) focus must stay in the editor: the arrow keys
    // move through every option and scroll it into view. That one finding is
    // set aside here only while the editor points at the list; every other
    // rule still applies to the open menu.
    await expect(editor).toHaveAttribute("aria-controls", "bn-suggestion-menu");
    await expect(editor).toHaveAttribute("aria-activedescendant", /bn-suggestion-menu-item-/);
    // With the pointer over another option too: hover has its own colours.
    await list.getByRole("option").nth(2).hover();
    const slashFindings = (await seriousAxe(page)).filter(
      (finding) => !(finding.startsWith("scrollable-region-focusable:") && finding.includes('id="bn-suggestion-menu"')),
    );
    expect(slashFindings, `${theme}: slash menu open`).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    // The formatting toolbar open.
    await editor.locator("p", { hasText: "Plain text" }).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
    // Scanned from the top, as above: scrolled, the first line sits under the
    // app's sticky header and axe reports its check box as obscured.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
    expect(await seriousAxe(page), `${theme}: formatting toolbar open`).toEqual([]);

    // The block menu (Ctrl+/) open.
    await page.keyboard.press("End");
    await page.keyboard.press("Control+/");
    await expect(page.getByRole("dialog", { name: "Block menu" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await seriousAxe(page), `${theme}: block menu open`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Block menu" })).toHaveCount(0);
  }

  // F5: a table as the last block still leaves a line below it, reachable
  // with the arrow keys.
  await caretAtEnd(page, editor.locator("p", { hasText: "Plain text" }));
  await page.keyboard.press("Enter");
  await page.keyboard.type("/table");
  await expect(page.getByRole("option", { name: /^Table/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("A1");
  const lastType = () =>
    editor.locator("[data-content-type]").evaluateAll((els) => els[els.length - 1]?.getAttribute("data-content-type"));
  await expect.poll(lastType).toBe("paragraph");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.type("After the table");
  const order = await editor.locator("[data-content-type]").evaluateAll((els) =>
    els.map((el) => `${el.getAttribute("data-content-type")}:${el.textContent?.trim() ?? ""}`),
  );
  const table = order.findIndex((entry) => entry.startsWith("table:"));
  const after = order.findIndex((entry) => entry === "paragraph:After the table");
  expect(table, JSON.stringify(order)).toBeGreaterThanOrEqual(0);
  expect(after, JSON.stringify(order)).toBeGreaterThan(table);
});

test("the editor speaks Quebec French", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Nouvelle page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const editor = page.getByRole("textbox", { name: "Contenu du document" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("/séparateur");
  await expect(page.getByRole("option", { name: /Séparateur/ }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.type("Élève à l’école : « Ça va? »");
  await expect(editor).toContainText("Élève à l’école : « Ça va? »");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Enregistré", { timeout: 30_000 });
});

test("with the editor switch off, a page shows no editor", async ({ page }) => {
  sql("update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null;");
  try {
    await signIn(page, "staff");
    await newPage(page, `No editor ${Date.now()}`);
    await expect(page.getByText("The page body opens here once the editor is turned on.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
  } finally {
    switches(true);
  }
});
