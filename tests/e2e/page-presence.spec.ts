import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "./fixtures";
import { signIn, type QaAccount } from "./auth";
import { sql } from "./db";

type BrowserContext = Awaited<ReturnType<Browser["newContext"]>>;

/**
 * Wave 2 unit C1: live presence and co-editing on pages, behind the
 * `wos_pages` and `wos_editor` switches.
 *
 *   C1-1  people on a page see each other in the header and their cursors
 *   C1-2  typing in different blocks at once: both kept, both saved
 *   C1-3  typing in the same block at once: both kept, or the conflict dialog
 *   C1-4  presence never shows someone who cannot open the page, and a
 *         closed tab leaves within 30 s
 *   C1-5  copies that cannot be merged live say "also editing" and fall back
 *         to the conflict dialog, never a silent loss
 */

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const NAMES: Record<string, string> = { staff: "QA Staff", pm: "QA Project Manager", lead: "QA Program Lead" };

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });

const paragraph = (id: string, text: string) => ({ id, type: "paragraph", props: {}, content: [{ type: "text", text }], children: [] });

/** A page the staff member wrote, with a saved body (and no live state yet). */
function seedPage(title: string, visibility: "workspace" | "private" = "workspace", texts = ["First block.", "Second block.", "Shared block."]): string {
  const blocks = texts.map((text, i) => paragraph(`b${i + 1}`, text));
  const content = JSON.stringify({ version: 1, blocks }).replace(/'/g, "''");
  return sql(`
    with org as (select organization_id from public.organization_membership where user_id = '${STAFF}'),
    p as (
      insert into public.page (organization_id, visibility, created_by, title)
      select organization_id, '${visibility}', '${STAFF}', '${title}' from org returning id, organization_id
    ),
    d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, content_text, created_by)
      select id, 'page', organization_id, '${content}'::jsonb, '${texts.join("\n").replace(/'/g, "''")}', '${STAFF}' from p returning object_id
    )
    select object_id from d;
  `);
}

const savedText = (pageId: string) => sql(`select content_text from public.editor_document where object_id = '${pageId}'`);
const hasLiveState = (pageId: string) =>
  sql(`select yjs_state is not null from public.editor_document where object_id = '${pageId}'`) === "t";

interface Person {
  context: BrowserContext;
  page: Page;
}

async function person(browser: Browser, account: QaAccount, options: Parameters<Browser["newContext"]>[0] = {}): Promise<Person> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signIn(page, account);
  return { context, page };
}

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

/** The editor's text without other people's cursor labels (which sit inside it). */
const editorText = (page: Page) =>
  page.locator(".qbbe-editor .bn-editor").evaluate((root) => {
    const copy = root.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".c1-cursor").forEach((cursor) => cursor.remove());
    return copy.textContent ?? "";
  });
const saveState = (page: Page) => page.getByTestId("editor-save-state");
const presenceButton = (page: Page) => page.getByTestId("page-presence").getByRole("button");

async function open(page: Page, pageId: string) {
  await page.goto(`/pages/${pageId}`);
  await expect(editorOf(page)).toBeVisible({ timeout: 30_000 });
}

/** Puts the caret at the end (or start) of a one-line block. */
async function caretIn(page: Page, blockId: string, where: "end" | "start" = "end") {
  const block = page.locator(`.qbbe-editor [data-id="${blockId}"] [data-content-type] .bn-inline-content`).first();
  await block.click();
  // The editor takes a click's caret on the browser's next selection event,
  // which can land after a key pressed at once and put the caret back where
  // the click was. Press the key until the editor itself (Tiptap attaches it
  // to its element) holds the caret at that end of this block.
  await expect(async () => {
    await page.keyboard.press(where === "end" ? "End" : "Home");
    const at = await page.evaluate(
      ({ id, end }) => {
        type Sel = { empty: boolean; $from: { parentOffset: number; parent: { content: { size: number } }; node: (depth: number) => { attrs: { id?: string } }; depth: number } };
        type WithEditor = Element & { editor?: { state: { selection: Sel } } };
        const dom = ([...document.querySelectorAll(".qbbe-editor .ProseMirror")] as WithEditor[]).find((el) => el.editor);
        const selection = dom?.editor?.state.selection;
        if (!selection || !selection.empty) return false;
        const { $from } = selection;
        let inBlock = false;
        for (let depth = $from.depth; depth >= 0; depth -= 1) if ($from.node(depth).attrs.id === id) inBlock = true;
        return inBlock && $from.parentOffset === (end ? $from.parent.content.size : 0);
      },
      { id: blockId, end: where === "end" },
    );
    expect(at, `the editor's caret is at the ${where} of block ${blockId}`).toBe(true);
  }).toPass({ timeout: 10_000 });
}

/**
 * The first editor saves once, so the page has a live state everyone who
 * opens it afterwards shares (pages never saved from the editor are converted
 * separately in each browser and cannot be merged live; see C1-5 below).
 */
async function establish(page: Page, pageId: string) {
  await caretIn(page, "b1");
  await page.keyboard.type(" Ready.");
  await expect(saveState(page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
  await expect.poll(() => hasLiveState(pageId), { timeout: 15_000 }).toBe(true);
}

/** Both editors are joined live: each sees the other's cursor. */
async function joinedLive(a: Page, aName: string, b: Page, bName: string) {
  await caretIn(a, "b1");
  await caretIn(b, "b2");
  await expect(a.locator(`.c1-cursor[data-c1-cursor="${bName}"] .c1-cursor__label`)).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(`.c1-cursor[data-c1-cursor="${aName}"] .c1-cursor__label`)).toBeVisible({ timeout: 30_000 });
}

async function seriousAxe(page: Page, within?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG);
  const results = await (within ? builder.include(within) : builder).analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)}`));
}

test.describe("switches on", () => {
  test.beforeAll(() => switches(true));

  test("people on the same page see each other in the header and their cursors in the text [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    const pageId = seedPage(`Presence ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    try {
      await open(a.page, pageId);
      await establish(a.page, pageId);
      await open(b.page, pageId);

      // C1-1: names and colours in the header.
      await expect(presenceButton(a.page)).toHaveAccessibleName(/QA Project Manager, editing/, { timeout: 30_000 });
      await expect(presenceButton(b.page)).toHaveAccessibleName(/QA Staff, editing/, { timeout: 30_000 });
      const chip = a.page.locator(`[data-testid="page-presence"] [data-presence-user]`).first();
      const colour = await chip.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(colour).toMatch(/^rgb\(/);
      // The list names everyone, and opens and closes from the keyboard.
      await presenceButton(a.page).focus();
      await a.page.keyboard.press("Enter");
      const list = a.page.getByTestId("page-presence-list");
      await expect(list).toContainText("QA Project Manager, editing");
      expect(await seriousAxe(a.page, '[data-testid="page-presence"]')).toEqual([]);
      await a.page.keyboard.press("Escape");
      await expect(list).toBeHidden();
      await expect(presenceButton(a.page)).toBeFocused();

      // C1-1: each person's cursor in the other's text, with their name.
      await joinedLive(a.page, NAMES.staff, b.page, NAMES.pm);
      await expect(a.page.locator(`.c1-cursor[data-c1-cursor="${NAMES.pm}"] .c1-cursor__label`)).toHaveText(NAMES.pm);
      // Edits arrive without a reload.
      await b.page.keyboard.type(" Hello from PM.");
      await expect.poll(() => editorText(a.page), { timeout: 15_000 }).toContain("Second block. Hello from PM.");
      // No live-sync notice while live.
      await expect(a.page.getByTestId("c1-also-editing")).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("two people typing in different blocks both keep their text and the saved page has both [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    const pageId = seedPage(`Co-edit blocks ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    try {
      await open(a.page, pageId);
      await establish(a.page, pageId);
      await open(b.page, pageId);
      await joinedLive(a.page, NAMES.staff, b.page, NAMES.pm);

      const alpha = " Alpha one two three four five six seven eight nine ten.";
      const bravo = " Bravo one two three four five six seven eight nine ten.";
      await Promise.all([a.page.keyboard.type(alpha, { delay: 25 }), b.page.keyboard.type(bravo, { delay: 25 })]);

      const expected = ["First block. Ready." + alpha, "Second block." + bravo];
      for (const p of [a.page, b.page]) {
        for (const text of expected) await expect.poll(() => editorText(p), { timeout: 15_000 }).toContain(text);
      }
      await expect(saveState(a.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      await expect(saveState(b.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      // Nobody was asked to choose: the saves merged.
      await expect(a.page.getByRole("dialog", { name: "Someone else saved this" })).toHaveCount(0);
      await expect(b.page.getByRole("dialog", { name: "Someone else saved this" })).toHaveCount(0);
      await expect.poll(() => savedText(pageId), { timeout: 30_000 }).toContain(expected[0]);
      await expect.poll(() => savedText(pageId), { timeout: 30_000 }).toContain(expected[1]);
      const saved = savedText(pageId);
      expect(saved.split(expected[0]).length - 1, "Alpha's text is saved exactly once").toBe(1);
      expect(saved.split(expected[1]).length - 1, "Bravo's text is saved exactly once").toBe(1);

      // A third person opening from the database alone sees both.
      const c = await person(browser, "lead");
      try {
        await open(c.page, pageId);
        for (const text of expected) await expect(editorOf(c.page)).toContainText(text);
      } finally {
        await c.context.close();
      }
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("two people typing in the same block both keep their text [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    const pageId = seedPage(`Co-edit same block ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    try {
      await open(a.page, pageId);
      await establish(a.page, pageId);
      await open(b.page, pageId);
      await joinedLive(a.page, NAMES.staff, b.page, NAMES.pm);

      // Both in the third block: one at its start, one at its end.
      await caretIn(a.page, "b3", "start");
      await caretIn(b.page, "b3", "end");
      const front = "Front words from staff. ";
      const back = " Back words from the PM.";
      await Promise.all([a.page.keyboard.type(front, { delay: 25 }), b.page.keyboard.type(back, { delay: 25 })]);

      const whole = `${front}Shared block.${back}`;
      for (const p of [a.page, b.page]) await expect.poll(() => editorText(p), { timeout: 15_000 }).toContain(whole);
      await expect(saveState(a.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      await expect(saveState(b.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      await expect.poll(() => savedText(pageId), { timeout: 30_000 }).toContain(whole);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("copies that cannot merge live say who is also editing and ask before anything is lost [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    // Never saved from the editor: each browser converts it separately.
    const pageId = seedPage(`Apart ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    try {
      await open(a.page, pageId);
      await open(b.page, pageId);
      await expect(a.page.getByTestId("c1-also-editing")).toHaveText(
        "QA Project Manager is also editing this page, but your changes are not shared live. If you both change it, you’ll be asked which version to keep. Reload the page to edit together.",
        { timeout: 30_000 },
      );
      await expect(b.page.getByTestId("c1-also-editing")).toContainText("QA Staff is also editing this page", { timeout: 30_000 });
      expect(await seriousAxe(a.page, ".qbbe-editor")).toEqual([]);

      // Both change it: the second save is a conflict the person resolves, never a silent overwrite.
      await caretIn(a.page, "b1");
      await a.page.keyboard.type(" From staff.");
      await expect(saveState(a.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      await caretIn(b.page, "b2");
      await b.page.keyboard.type(" From PM.");
      await expect(b.page.getByRole("dialog", { name: "Someone else saved this" })).toBeVisible({ timeout: 30_000 });
      expect(savedText(pageId)).toContain("First block. From staff.");
      expect(savedText(pageId)).not.toContain("From PM.");

      // Reloading joins the copies: the notice goes and the two edit live.
      await b.page.getByRole("dialog", { name: "Someone else saved this" }).getByRole("button", { name: "Take theirs" }).click();
      await b.page.reload();
      await expect(editorOf(b.page)).toBeVisible({ timeout: 30_000 });
      await a.page.reload();
      await expect(editorOf(a.page)).toBeVisible({ timeout: 30_000 });
      await joinedLive(a.page, NAMES.staff, b.page, NAMES.pm);
      await expect(a.page.getByTestId("c1-also-editing")).toHaveCount(0);
      await expect(b.page.getByTestId("c1-also-editing")).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("presence never shows someone who cannot open the page, and a closed tab leaves within 30 seconds [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    const pageId = seedPage(`Leaving ${randomUUID().slice(0, 8)}`);
    const privateId = seedPage(`Staff private ${randomUUID().slice(0, 8)}`, "private");
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    const outsider = await person(browser, "volunteer");
    try {
      // Someone who cannot open the page is refused it and never appears.
      await open(a.page, pageId);
      await outsider.page.goto(`/pages/${pageId}`);
      await expect(outsider.page.getByTestId("page-presence")).toHaveCount(0);
      // The PM cannot open the staff member's private page either.
      await b.page.goto(`/pages/${privateId}`);
      await open(a.page, privateId);
      await a.page.waitForTimeout(PRESENCE_SETTLE_MS);
      await expect(a.page.getByTestId("page-presence")).toHaveCount(0);
      expect(Number(sql(`select count(*) from public.page_presence where page_id = '${privateId}'`))).toBe(1);

      // Two people; one closes the tab.
      await open(a.page, pageId);
      await a.page.waitForTimeout(PRESENCE_SETTLE_MS);
      await expect(a.page.getByTestId("page-presence")).toHaveCount(0);
      await open(b.page, pageId);
      await expect(presenceButton(a.page)).toHaveAccessibleName(/QA Project Manager/, { timeout: 30_000 });
      const closedAt = Date.now();
      await b.page.close({ runBeforeUnload: true });
      await expect(a.page.getByTestId("page-presence")).toHaveCount(0, { timeout: 30_000 });
      expect(Date.now() - closedAt).toBeLessThan(30_000);

      // A tab that vanished without a goodbye (a crash) also goes within 30 s.
      const c = await b.context.newPage();
      await open(c, pageId);
      await expect(presenceButton(a.page)).toHaveAccessibleName(/QA Project Manager/, { timeout: 30_000 });
      await c.route("**/*", (route) => route.abort());
      await c.evaluate(() => {
        // Stop every timer and the goodbye: as if the process died.
        window.addEventListener("pagehide", (event) => event.stopImmediatePropagation(), true);
        const highest = window.setTimeout(() => undefined, 0);
        for (let i = 0; i <= highest; i++) {
          window.clearTimeout(i);
          window.clearInterval(i);
        }
      });
      const vanishedAt = Date.now();
      await expect(a.page.getByTestId("page-presence")).toHaveCount(0, { timeout: 30_000 });
      expect(Date.now() - vanishedAt).toBeLessThan(30_000);
    } finally {
      await a.context.close();
      await b.context.close();
      await outsider.context.close();
    }
  });

  test("the header list works in French, at 320 px, by keyboard and in both themes [switches on]", async ({ browser }) => {
    test.setTimeout(180_000);
    const pageId = seedPage(`Présence ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff", { viewport: { width: 320, height: 720 } });
    const b = await person(browser, "pm");
    try {
      await a.context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
      await open(b.page, pageId);
      await a.page.goto(`/pages/${pageId}`);
      await expect(a.page.locator("html")).toHaveAttribute("lang", "fr-CA");
      const button = presenceButton(a.page);
      await expect(button).toHaveAccessibleName(/1 autre personne ici: QA Project Manager, en modification/, { timeout: 30_000 });
      await button.focus();
      await a.page.keyboard.press("Enter");
      await expect(a.page.getByRole("region", { name: "Personnes sur cette page" })).toContainText("Aussi sur cette page");
      // The open list fits on screen and adds no horizontal scroll. (The
      // pages sidebar already overflows at 320 px without C1; measured
      // against the same page with C1's header hidden.)
      const panel = await a.page.getByRole("region", { name: "Personnes sur cette page" }).boundingBox();
      expect(panel!.x).toBeGreaterThanOrEqual(0);
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(320);
      const widths = await a.page.evaluate(() => {
        const withC1 = document.documentElement.scrollWidth;
        const header = document.querySelector<HTMLElement>('[data-testid="page-presence"]')!;
        header.style.display = "none";
        const without = document.documentElement.scrollWidth;
        header.style.display = "";
        return { withC1, without };
      });
      expect(widths.withC1, "no horizontal scroll added at 320 px").toBeLessThanOrEqual(widths.without);
      for (const theme of ["light", "dark"] as const) {
        await a.page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
        expect(await seriousAxe(a.page, '[data-testid="page-presence"]'), `${theme} theme`).toEqual([]);
      }
      await a.page.keyboard.press("Escape");
      await expect(button).toBeFocused();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test("alone on a page with live editing on, undo and redo keep their history and undo stops at the page as opened [switches on]", async ({ browser }) => {
    test.setTimeout(120_000);
    // An empty page: the first undo step there holds the page's first block.
    const pageId = seedPage(`Live undo ${randomUUID().slice(0, 8)}`, "workspace", []);
    const a = await person(browser, "staff");
    try {
      await open(a.page, pageId);
      // The live session is on once the page lists this person as editing.
      await expect
        .poll(() => sql(`select count(*) from public.page_presence where page_id = '${pageId}' and editing`), { timeout: 30_000 })
        .not.toBe("0");
      const editor = editorOf(a.page);
      const blocks = editor.locator(".bn-block-content[data-content-type]");
      await editor.click();
      await expect(blocks).toHaveCount(1);
      await a.page.keyboard.type("Typed alone");

      // Undo, then Redo brings the text back.
      await a.page.keyboard.press("Control+z");
      await expect.poll(() => editorText(a.page)).toBe("");
      await a.page.keyboard.press("Control+Shift+z");
      await expect.poll(() => editorText(a.page)).toBe("Typed alone");

      // Undo more often than there are steps: the page stays as it was
      // opened, and nothing was added to the history on the way, so Redo
      // still brings the text back.
      for (let i = 0; i < 4; i += 1) await a.page.keyboard.press("Control+z");
      await expect.poll(() => editorText(a.page)).toBe("");
      await expect(blocks).toHaveCount(1);
      await a.page.keyboard.press("Control+Shift+z");
      await expect.poll(() => editorText(a.page)).toBe("Typed alone");
      await expect(blocks).toHaveCount(1);
      // And it is saved.
      await expect(saveState(a.page)).toHaveAttribute("data-save-status", "saved", { timeout: 30_000 });
      await expect.poll(() => savedText(pageId), { timeout: 15_000 }).toContain("Typed alone");
    } finally {
      await a.context.close();
    }
  });

  test("when presence cannot be read the header says so and Try again recovers [switches on]", async ({ browser }) => {
    test.setTimeout(120_000);
    const pageId = seedPage(`Presence error ${randomUUID().slice(0, 8)}`);
    const a = await person(browser, "staff");
    const b = await person(browser, "pm");
    try {
      await open(b.page, pageId);
      // Every server action from this tab fails until released.
      await a.page.route(`**/pages/${pageId}`, (route) =>
        route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort() : route.continue(),
      );
      await open(a.page, pageId);
      const error = a.page.getByTestId("page-presence-error");
      await expect(error).toContainText("Can’t show who else is here.", { timeout: 30_000 });
      await a.page.unroute(`**/pages/${pageId}`);
      await error.getByRole("button", { name: "Try again" }).click();
      await expect(presenceButton(a.page)).toHaveAccessibleName(/QA Project Manager/, { timeout: 30_000 });
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});

/** Longer than a heartbeat and a poll together: anything that would appear has appeared. */
const PRESENCE_SETTLE_MS = 9_000;

test("with the editor switch off there is no presence and nothing to call [switch off]", async ({ browser }) => {
  test.setTimeout(120_000);
  sql("update public.feature_flag set enabled = true where key = 'wos_pages' and organization_id is null;");
  sql("update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null;");
  const pageId = seedPage(`No presence ${randomUUID().slice(0, 8)}`);
  const a = await person(browser, "staff");
  const b = await person(browser, "pm");
  try {
    await a.page.goto(`/pages/${pageId}`);
    await b.page.goto(`/pages/${pageId}`);
    await expect(a.page.getByRole("heading", { level: 1 }).or(a.page.getByRole("textbox", { name: "Page title" })).first()).toBeVisible();
    await a.page.waitForTimeout(PRESENCE_SETTLE_MS);
    await expect(a.page.getByTestId("page-presence")).toHaveCount(0);
    await expect(a.page.getByTestId("page-presence-error")).toHaveCount(0);
    await expect(a.page.locator(".c1-cursor")).toHaveCount(0);
    expect(Number(sql(`select count(*) from public.page_presence where page_id = '${pageId}'`))).toBe(0);
    const leave = await a.page.request.post(`/api/pages/${pageId}/presence`);
    expect(leave.status()).toBe(404);
  } finally {
    await a.context.close();
    await b.context.close();
    switches(false);
  }
});
