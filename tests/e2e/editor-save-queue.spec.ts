import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS operation-based save queue (U3, epic #199) behind the
 * `wos_pages` and `wos_editor` switches: an edit made offline is kept on the
 * device and sent when the connection returns, and a save from another
 * window is a conflict the person resolves (keep mine, take theirs, review)
 * instead of an overwrite.
 */

// Turned on and never off, so parallel specs never see it flip.
test.beforeAll(() =>
  sql("update public.feature_flag set enabled = true where key in ('wos_pages', 'wos_editor') and organization_id is null;"),
);

async function newPage(page: Page, title: string): Promise<string> {
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(title);
  await titleBox.press("Enter");
  return page.url().split("/").pop()!;
}

const contentText = (pageId: string) => sql(`select content_text from public.editor_document where object_id = '${pageId}'`);
const operations = (pageId: string) => Number(sql(`select count(*) from public.editor_operation where object_id = '${pageId}'`));

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

test("offline edits are sent when back online [switches on]", async ({ page, context }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Offline queue ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const status = page.getByTestId("editor-save-state");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();

  // Feedback is immediate: the pill says "Saving…" before the batch delay has passed.
  await page.keyboard.type("Online first");
  await expect(status).toHaveText("Saving…", { timeout: 300 });
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  expect(contentText(pageId)).toBe("Online first");
  expect(operations(pageId)).toBe(1);

  // The connection drops; an edit is kept on the device, not sent.
  await context.setOffline(true);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Written offline");
  await expect(status).toHaveAttribute("data-save-status", "offline");
  await expect(status).toHaveText("Offline. Your changes will be saved when you're back online.");
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`editor-queue:${id}`), pageId))
    .toContain("Written offline");
  expect(contentText(pageId)).toBe("Online first");

  // Back online: the queue sends on its own, the row is updated and the device copy is cleared.
  await context.setOffline(false);
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  expect(contentText(pageId)).toBe("Online first\nWritten offline");
  expect(operations(pageId)).toBe(2);
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`editor-queue:${id}`), pageId)).toBeNull();
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(await seriousAxe(page)).toEqual([]);
});

test("a conflict offers keep mine or take theirs [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Conflict queue ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const status = page.getByTestId("editor-save-state");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Mine first");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });

  // Someone else saves in another window: the row's version moves on.
  const theirs = (text: string) =>
    sql(`update public.editor_document
         set content = '{"version":1,"blocks":[{"id":"theirs","type":"paragraph","content":[{"type":"text","text":"${text}"}]}]}'::jsonb,
             content_text = '${text}', yjs_state = null
         where object_id = '${pageId}'`);
  theirs("Their change");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Mine second");

  const dialog = page.getByRole("dialog", { name: "Someone else saved this" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(status).toHaveAttribute("data-save-status", "conflict");
  await expect(status).toHaveText("Someone else saved this in another window. Choose what to keep.");
  // Still editable while the person decides.
  await expect(editor).toHaveAttribute("contenteditable", "true");

  // Review: theirs on the left, mine on the right, read-only.
  await dialog.getByRole("button", { name: "Review" }).click();
  const review = page.getByTestId("editor-conflict-review");
  await expect(review).toContainText("Their change");
  await expect(review).toContainText("Mine second");
  await expect(review.getByRole("columnheader", { name: "Theirs" })).toBeVisible();
  await expect(review.getByRole("columnheader", { name: "Mine" })).toBeVisible();
  expect(await seriousAxe(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Back to choices" }).click();
  await expect(review).toHaveCount(0);

  // Closing without choosing keeps the conflict and a way back to it.
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(dialog).toBeVisible();

  // Keep mine: saved on top of their version, nothing lost.
  await dialog.getByRole("button", { name: "Keep mine" }).click();
  await expect(dialog).toBeHidden();
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  expect(contentText(pageId)).toBe("Mine first\nMine second");
  expect(Number(sql(`select version from public.editor_document where object_id = '${pageId}'`))).toBeGreaterThanOrEqual(3);

  // A second conflict, resolved the other way: their content replaces mine in the editor.
  theirs("Their second change");
  // The closed dialog returned focus to the page; type in the editor again.
  await editor.locator("p", { hasText: "Mine second" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" and more");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const take = dialog.getByRole("button", { name: "Take theirs" });
  await expect(take).toBeEnabled({ timeout: 15_000 });
  await take.click();
  await expect(dialog).toBeHidden();
  await expect(editor).toContainText("Their second change", { timeout: 15_000 });
  await expect(editor).not.toContainText("Mine second");
  await expect(status).toHaveText("Saved");
  expect(contentText(pageId)).toBe("Their second change");

  // Editing goes on from their version.
  await editor.locator("p", { hasText: "Their second change" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(", agreed");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });
  expect(contentText(pageId)).toBe("Their second change, agreed");
});

test("an edit kept on the device is put back after a reload [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, "staff");
  const pageId = await newPage(page, `Reload queue ${Date.now()}`);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const status = page.getByTestId("editor-save-state");
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("Before the reload");
  await expect(status).toHaveText("Saved", { timeout: 30_000 });

  // The server stops answering saves: the edit is kept on the device and retried.
  const isSave = (headers: Record<string, string>) => "next-action" in headers;
  await page.route("**/pages/**", (route) =>
    isSave(route.request().headers()) ? route.abort("connectionfailed") : route.fallback(),
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("Typed while saves failed, then reloaded");
  await expect(status).toHaveAttribute("data-save-status", "failed", { timeout: 30_000 });
  await expect(status).toHaveText("Couldn't save. Your changes are kept and will be retried.");
  await expect
    .poll(() => page.evaluate((id) => localStorage.getItem(`editor-queue:${id}`), pageId))
    .toContain("then reloaded");
  expect(contentText(pageId)).toBe("Before the reload");

  // Leaving warns; the edit still only exists on this device. Back, it is put back and sent.
  await page.unroute("**/pages/**");
  page.on("dialog", (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("then reloaded", { timeout: 30_000 });
  await expect(page.getByText("Unsaved changes from your last visit were put back.")).toBeVisible();
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(contentText(pageId)).toBe("Before the reload\nTyped while saves failed, then reloaded");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`editor-queue:${id}`), pageId)).toBeNull();
});
