import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit E2, behind the `wos_pages` and `wos_editor` switches: undo and
 * redo across every kind of change, one step each; the history starting at
 * the opened page and again after a save from elsewhere; the Undo and Redo
 * buttons and keys; and the keyboard shortcuts dialog.
 */

// On for this file and back to the default (off) after it, as wos-editor does.
const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);
// The pages this file makes go to the trash when it is done.
const created: string[] = [];
test.beforeAll(() => switches(true));
test.afterAll(() => {
  switches(false);
  if (created.length > 0) {
    sql(`update public.page set deleted_at = now() where deleted_at is null and id in (${created.map((id) => `'${id}'`).join(", ")})`);
  }
});

// A script error in the page (such as one thrown while a key is handled) fails the test.
const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

async function newPage(page: Page, title: string, newPageName = "New page"): Promise<string> {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: /Pages/ }).getByRole("button", { name: newPageName, exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: /Page title|Titre de la page/ });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  const id = page.url().split("/").pop()!;
  created.push(id);
  return id;
}

/** Each block as "type:colour:text", in order. */
function snapshot(editor: Locator) {
  return editor.locator(".bn-block-content[data-content-type]").evaluateAll((els) =>
    els.map((el) => `${el.getAttribute("data-content-type")}:${el.getAttribute("data-text-color") ?? "default"}:${el.textContent ?? ""}`),
  );
}

const live = (page: Page) => page.locator("#qbbe-editor-live");

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

/**
 * The text of the paragraph holding the editor's own caret, when that caret
 * is collapsed at the paragraph's end; otherwise null. Read from the editor's
 * state (Tiptap attaches the editor to its element), not from the browser's
 * selection, which the editor may not have taken in yet.
 */
function editorCaretAtEnd(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    type Sel = { empty: boolean; $from: { parentOffset: number; parent: { textContent: string; content: { size: number } } } };
    type WithEditor = Element & { editor?: { state: { selection: Sel } } };
    const focused = document.activeElement?.closest(".ProseMirror") as WithEditor | null;
    const dom = focused?.editor ? focused : ([...document.querySelectorAll(".ProseMirror")] as WithEditor[]).find((el) => el.editor);
    const selection = dom?.editor?.state.selection;
    if (!selection || !selection.empty) return null;
    const { $from } = selection;
    return $from.parentOffset === $from.parent.content.size ? $from.parent.textContent : null;
  });
}

/**
 * Puts the caret at the end of a paragraph's text and waits until the editor
 * itself has it there: the editor takes a click's caret on the browser's next
 * selection event, which can land after a key pressed at once.
 */
async function caretAtEndOf(page: Page, paragraph: Locator, text: string) {
  await paragraph.click();
  await expect(async () => {
    await page.keyboard.press("End");
    expect(await editorCaretAtEnd(page)).toBe(text);
  }).toPass({ timeout: 10_000 });
}

async function openEditor(page: Page) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

test("undo and redo go through typing, new blocks, moves, turn into, colour, duplicate and delete one step each [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "staff");
  await newPage(page, `History steps ${Date.now()}`);
  const editor = await openEditor(page);
  await editor.click();

  const states: string[][] = [await snapshot(editor)];
  const record = async () => {
    states.push(await snapshot(editor));
  };
  const blockMenu = page.getByRole("dialog", { name: "Block menu" });

  // Typing, then a new block, then typing in it: three steps.
  await page.keyboard.type("Alpha");
  await record();
  await page.keyboard.press("Enter");
  await record();
  await page.keyboard.type("Beta");
  await record();
  // Move it up.
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect.poll(() => snapshot(editor)).not.toEqual(states.at(-1));
  await record();
  // Turn into a quote, from the block menu.
  await page.keyboard.press("Control+/");
  await blockMenu.getByRole("button", { name: "Turn into Quote" }).click();
  await expect(blockMenu).toHaveCount(0);
  await expect(editor.locator("[data-content-type='quote']")).toHaveText("Beta");
  await record();
  // A colour.
  await page.keyboard.press("Control+/");
  await blockMenu.getByLabel("Text color").selectOption("red");
  await page.keyboard.press("Escape");
  await expect(blockMenu).toHaveCount(0);
  await expect(editor.locator("[data-content-type='quote']")).toHaveAttribute("data-text-color", "red");
  await record();
  // Duplicate.
  await page.keyboard.press("Control+/");
  await blockMenu.getByRole("button", { name: "Duplicate" }).click();
  await expect(editor.locator("[data-content-type='quote']")).toHaveCount(2);
  await record();
  // Delete.
  await page.keyboard.press("Control+/");
  await blockMenu.getByRole("button", { name: "Delete" }).click();
  await expect(editor.locator("[data-content-type='quote']")).toHaveCount(1);
  await record();

  // Every state differs from the one before: each action changed something.
  for (let i = 1; i < states.length; i += 1) expect(states[i], `step ${i}`).not.toEqual(states[i - 1]);

  // Ctrl+Z goes back one action at a time, to the empty page.
  await expect(editor).toBeFocused();
  for (let i = states.length - 2; i >= 0; i -= 1) {
    await page.keyboard.press("Control+z");
    await expect.poll(() => snapshot(editor), { message: `after undoing to state ${i}` }).toEqual(states[i]);
    await expect(live(page)).toHaveText("Undone.");
  }
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  expect(await snapshot(editor)).toEqual(states[0]);

  // Redo forward one at a time, with both redo keys.
  for (let i = 1; i < states.length; i += 1) {
    await page.keyboard.press(i % 2 === 0 ? "Control+y" : "Control+Shift+z");
    await expect.poll(() => snapshot(editor), { message: `after redoing to state ${i}` }).toEqual(states[i]);
    await expect(live(page)).toHaveText("Redone.");
  }
  await page.keyboard.press("Control+y");
  await expect(live(page)).toHaveText("Nothing more to redo");
});

test("undo stops at the page as it was opened and says so [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `History start ${Date.now()}`);
  let editor = await openEditor(page);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });

  // A new, empty page: nothing to undo.
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await editor.click();
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");

  await page.keyboard.type("Saved before opening");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect(undo).toHaveAttribute("aria-disabled", "false");

  // Opened again: the saved text is where undo stops.
  await page.reload();
  editor = await openEditor(page);
  await expect(editor).toContainText("Saved before opening");
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await caretAtEndOf(page, editor.locator("p", { hasText: "Saved before opening" }), "Saved before opening");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(editor).toContainText("Saved before opening");
  // An undo with nothing to undo leaves the caret where it was.
  expect(await editorCaretAtEnd(page)).toBe("Saved before opening");

  await page.keyboard.type(" and after");
  await expect(editor).toContainText("Saved before opening and after");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Undone.");
  await expect(editor).not.toContainText("and after");
  await expect(editor).toContainText("Saved before opening");
  // The button says so too (it is marked unavailable, but still answers), and keeps focus.
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(editor).toContainText("Saved before opening");
  await expect(undo).toBeFocused();
  // The live region is polite, so screen readers read it out.
  await expect(live(page)).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select content_text from public.editor_document where object_id = '${pageId}'`)).toBe("Saved before opening");
});

test("undo stops at the last restore: an edit put back from the device is where history starts [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `History restore ${Date.now()}`);
  const editor = await openEditor(page);
  const status = page.getByTestId("editor-save-state");
  await editor.click();
  await page.keyboard.type("Saved first");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });

  // Saves fail, the edit is kept on the device, and the page is reloaded.
  const isSave = (headers: Record<string, string>) => "next-action" in headers;
  await page.route("**/pages/**", (route) => (isSave(route.request().headers()) ? route.abort("connectionfailed") : route.fallback()));
  await page.keyboard.press("Enter");
  await page.keyboard.type("Kept on the device");
  await expect(status).toHaveAttribute("data-save-status", "failed", { timeout: 30_000 });
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`editor-queue:${id}`), pageId)).toContain("Kept on the device");
  await page.unroute("**/pages/**");
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  const restored = page.getByRole("textbox", { name: "Document content" });
  await expect(restored).toContainText("Kept on the device", { timeout: 30_000 });
  await expect(page.getByText("Unsaved changes from your last visit were put back.")).toBeVisible();

  // The put-back edit is the starting point: undo does not take it away.
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("aria-disabled", "true");
  await caretAtEndOf(page, restored.locator("p", { hasText: "Kept on the device" }), "Kept on the device");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(restored).toContainText("Saved first");
  await expect(restored).toContainText("Kept on the device");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("the Undo and Redo buttons have names and work with the keys [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "staff");
  await newPage(page, `History buttons ${Date.now()}`);
  const editor = await openEditor(page);
  const group = page.getByRole("group", { name: "Undo history" });
  const undo = group.getByRole("button", { name: "Undo", exact: true });
  const redo = group.getByRole("button", { name: "Redo", exact: true });
  await expect(undo).toBeVisible();
  await expect(redo).toBeVisible();
  await expect(group.getByRole("button", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(undo).toHaveAttribute("aria-keyshortcuts", /Z/);

  await editor.click();
  await page.keyboard.type("Button test");
  await expect(undo).toHaveAttribute("aria-disabled", "false");
  await undo.click();
  await expect(editor).not.toContainText("Button test");
  await expect(live(page)).toHaveText("Undone.");
  await expect(redo).toHaveAttribute("aria-disabled", "false");
  await redo.click();
  await expect(editor).toContainText("Button test");
  await expect(live(page)).toHaveText("Redone.");
  // Marked unavailable now, but it still answers.
  await expect(redo).toHaveAttribute("aria-disabled", "true");
  await redo.focus();
  await page.keyboard.press("Enter");
  await expect(live(page)).toHaveText("Nothing more to redo");

  // The keys work from the buttons as well as from the text.
  await undo.focus();
  await page.keyboard.press("Control+z");
  await expect(editor).not.toContainText("Button test");
  await page.keyboard.press("Control+y");
  await expect(editor).toContainText("Button test");
  // And the buttons by keyboard.
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(editor).not.toContainText("Button test");
  await redo.focus();
  await page.keyboard.press("Space");
  await expect(editor).toContainText("Button test");
});

test("the keyboard shortcuts dialog lists every shortcut, from ? or its button, by keyboard [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  await newPage(page, `Shortcuts ${Date.now()}`);
  const editor = await openEditor(page);
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  const shortcutsButton = page.getByRole("button", { name: "Keyboard shortcuts" });

  // "?" typed in the text is text.
  await editor.click();
  await page.keyboard.type("Why?");
  await expect(editor).toContainText("Why?");
  await expect(dialog).toHaveCount(0);

  // "?" outside the text opens the dialog.
  await shortcutsButton.focus();
  await page.keyboard.press("Shift+?");
  await expect(dialog).toBeVisible();
  const list = dialog.getByTestId("editor-shortcuts");
  await expect(list.locator("tr[data-shortcut]")).toHaveCount(26);
  for (const name of ["Undo the last change", "Redo what was undone", "Bold", "Open the block menu: move, duplicate, color, turn into, delete", "Move the block up or down", "Leave the editor", "Show these keyboard shortcuts (outside the text)"]) {
    await expect(list.getByRole("rowheader", { name, exact: true })).toBeVisible();
  }
  const undoRow = list.locator("tr[data-shortcut='undo']");
  await expect(undoRow.locator("kbd")).toHaveText(["Ctrl", "Z"]);
  await expect(list.locator("tr[data-shortcut='redo'] kbd")).toHaveText(["Shift", "Ctrl", "Z", "Ctrl", "Y"]);
  for (const group of ["Undo and redo", "Text", "Blocks", "Moving around", "Help"]) {
    await expect(list.locator("caption", { hasText: group })).toHaveCount(1);
  }

  // Keyboard only: Tab reaches the list (it scrolls) and the close button, Escape closes and gives focus back.
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    expect(await seriousAxe(page), theme).toEqual([]);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
  const reached = [await focused()];
  await page.keyboard.press("Tab");
  reached.push(await focused());
  expect(reached.sort()).toEqual(["Close dialog", "Keyboard shortcuts"]);
  // The list scrolls from the keyboard.
  await list.focus();
  await page.keyboard.press("End");
  await expect.poll(() => list.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(shortcutsButton).toBeFocused();

  // From the button, with Enter.
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toHaveCount(0);

  // At 320 px the buttons stay within the editor's width and wrap rather than
  // scroll, and the dialog fits on screen. (At this width the page and the
  // editor themselves are still a little wider than the screen; mobile
  // editing is unit E4's.)
  await page.setViewportSize({ width: 320, height: 640 });
  const group = page.getByRole("group", { name: "Undo history" });
  await group.scrollIntoViewIfNeeded();
  const groupBox = (await group.boundingBox())!;
  const editorBox = (await editor.boundingBox())!;
  expect(groupBox.x).toBeGreaterThanOrEqual(editorBox.x - 1);
  expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(editorBox.x + editorBox.width + 1);
  expect(await group.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await shortcutsButton.click();
  await expect(dialog).toBeVisible();
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("in a task drawer, ? opens the shortcuts and undo is announced inside the drawer [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "owner");
  const title = `History drawer ${Date.now()}`;
  await page.goto("/my-work?create=task");
  const create = page.getByRole("dialog", { name: "Create task" });
  await expect(create).toBeVisible({ timeout: 30_000 });
  await create.getByLabel("Title", { exact: true }).fill(title);
  await create.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(create).not.toBeVisible({ timeout: 30_000 });
  const taskId = sql(`select id::text from task where title = '${title}' limit 1`);
  try {
    await page.goto(`/my-work?task=${taskId}`);
    const drawer = page.getByRole("dialog").first();
    await expect(drawer.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
    const editor = drawer.getByRole("textbox", { name: "Description" });
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.type("Drawer words");
    await page.keyboard.press("Control+z");
    await expect(editor).not.toContainText("Drawer words");
    await expect(drawer.locator("#qbbe-editor-live")).toHaveText("Undone.");

    // "?" from the drawer's buttons (inside the drawer, a modal) opens the list.
    await drawer.getByRole("button", { name: "Undo", exact: true }).focus();
    await page.keyboard.press("Shift+?");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(shortcuts).toHaveCount(0);
    await expect(drawer).toBeVisible();
  } finally {
    sql(`update public.task set archived_at = now() where id = '${taskId}' and archived_at is null;`);
  }
});

test("the shortcuts and the history speak Québec French [switches on]", async ({ page, context }) => {
  test.setTimeout(120_000);
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await newPage(page, `Raccourcis ${Date.now()}`, "Nouvelle page");
  const editor = page.getByRole("textbox", { name: "Contenu du document" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const undo = page.getByRole("button", { name: "Annuler la dernière modification", exact: true });
  // Never confused with a cancel button: no button in the editor is named just « Annuler ».
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Historique des modifications" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rétablir", exact: true })).toBeVisible();
  await editor.click();
  await page.keyboard.type("Bonjour");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Annulé.");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Rien d’autre à annuler");

  await undo.focus();
  await page.keyboard.press("Shift+?");
  const dialog = page.getByRole("dialog", { name: "Raccourcis clavier" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("rowheader", { name: "Annuler la dernière modification" })).toBeVisible();
  await expect(dialog.locator("tr[data-shortcut='redo'] kbd")).toHaveText(["Maj", "Ctrl", "Z", "Ctrl", "Y"]);
  await expect(dialog.locator("tr[data-shortcut='leave']")).toContainText("Échap puis Tab");
  expect(await seriousAxe(page)).toEqual([]);
});

test("after a save from elsewhere the history starts again [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `History conflict ${Date.now()}`);
  const editor = await openEditor(page);
  const status = page.getByTestId("editor-save-state");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await editor.click();
  await page.keyboard.type("Mine first");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  await expect(undo).toHaveAttribute("aria-disabled", "false");

  // Someone else saves the page in another window.
  sql(`update public.editor_document
       set content = '{"version":1,"blocks":[{"id":"theirs","type":"paragraph","content":[{"type":"text","text":"Their change"}]}]}'::jsonb,
           content_text = 'Their change', yjs_state = null
       where object_id = '${pageId}'`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mine second");
  const conflict = page.getByRole("dialog", { name: "Someone else saved this" });
  await expect(conflict).toBeVisible({ timeout: 30_000 });
  // Undo is not offered over their save: the history started again, and screen readers hear why.
  await expect(live(page)).toHaveText("Someone else saved this page. Undo starts again from here.");
  await expect(undo).toHaveAttribute("aria-disabled", "true");

  await conflict.getByRole("button", { name: "Keep mine" }).click();
  await expect(conflict).toBeHidden();
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  await caretAtEndOf(page, editor.locator("p", { hasText: "Mine second" }), "Mine second");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(editor).toContainText("Mine first");
  await expect(editor).toContainText("Mine second");

  // New edits are undoable again, back to that point only.
  await page.keyboard.type(" plus");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Undone.");
  await expect(editor).not.toContainText("Mine second plus");
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(editor).toContainText("Mine second");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });

  // Another save from elsewhere, and this time their version is taken: the
  // editor opens on it with an empty history.
  sql(`update public.editor_document
       set content = '{"version":1,"blocks":[{"id":"theirs2","type":"paragraph","content":[{"type":"text","text":"Their second change"}]}]}'::jsonb,
           content_text = 'Their second change', yjs_state = null
       where object_id = '${pageId}'`);
  await page.keyboard.type(" again");
  await expect(conflict).toBeVisible({ timeout: 30_000 });
  const take = conflict.getByRole("button", { name: "Take theirs" });
  await expect(take).toBeEnabled({ timeout: 15_000 });
  await take.click();
  await expect(editor).toContainText("Their second change", { timeout: 15_000 });
  await expect(undo).toHaveAttribute("aria-disabled", "true");
  await editor.locator("p", { hasText: "Their second change" }).click();
  await page.keyboard.press("Control+z");
  await expect(live(page)).toHaveText("Nothing more to undo");
  await expect(editor).toContainText("Their second change");
});

test("with the editor switch off, there is no history or shortcuts dialog [switch off]", async ({ page }) => {
  sql("update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null;");
  try {
    await signIn(page, "staff");
    await newPage(page, `No history ${Date.now()}`);
    await expect(page.getByText("The page body opens here once the editor is turned on.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await page.locator("body").press("Shift+?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_editor' and organization_id is null;");
  }
});
