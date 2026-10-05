import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit E5: speed on long pages, behind the `wos_editor` switch.
 * View blocks and embeds wait until they are near the screen and keep their
 * space; the editor marks when it opened and when typing works; long pages
 * stay usable.
 *
 * Budgets (production build, local machine, recorded in the PR):
 *   100-block page: open within OPEN_BUDGET_MS, typing works within
 *   INTERACTIVE_BUDGET_MS, layout shift below 0.1;
 *   500-block page: every key typed at the end handled within 100 ms.
 */

const RUN = `E5 ${Date.now().toString(36)}`;
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const SWITCHES = "('wos_pages', 'wos_editor', 'wos_lenses')";
const OPEN_BUDGET_MS = 5_000;
const INTERACTIVE_BUDGET_MS = 6_000;
const KEY_BUDGET_MS = 100;
let previous = "";

const esc = (s: string) => s.replace(/'/g, "''");

/**
 * A page of `count` top-level blocks: a table of contents first, a heading
 * every 10th block, a view block at 7, 32, 57, 82… and an embed at 17, 42,
 * 67, 92…, and paragraphs between.
 */
function longPage(label: string, count: number): string {
  const blocks: unknown[] = [{ type: "tableOfContents" }];
  for (let i = 1; i < count; i++) {
    if (i % 10 === 0) blocks.push({ type: "heading", props: { level: 2 }, content: [{ type: "text", text: `Section ${i}` }] });
    else if (i % 25 === 7) {
      blocks.push({
        type: "query",
        props: { preset: "my_open", spec: JSON.stringify({
            version: 2,
            source: { type: "task" },
            layout: "table",
            title: `${label} view ${i}`,
            where: [{ path: "title", op: "starts_with", value: RUN }],
          }) },
      });
    } else if (i % 25 === 17) blocks.push({ type: "embed", props: { url: `https://www.youtube.com/watch?v=E5test${String(i).padStart(5, "0")}` } });
    else blocks.push({ type: "paragraph", content: [{ type: "text", text: `Paragraph ${i} of a long page, with enough words to fill a line.` }] });
  }
  // Saved pages keep their block ids; heights are remembered by id.
  const content = { version: 1, blocks: blocks.map((block) => ({ id: randomUUID(), ...(block as object) })) };
  return sql(`
    with p as (
      insert into public.page (organization_id, title, visibility, created_by)
      select organization_id, '${esc(`${RUN} ${label}`)}', 'workspace', '${STAFF}' from public.organization_membership where user_id = '${STAFF}'
      returning id, organization_id
    ), d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, created_by)
      select id, 'page', organization_id, '${esc(JSON.stringify(content))}'::jsonb, '${STAFF}' from p
    )
    select id from p;
  `);
}

/** Collects layout shifts (not caused by input) from the very start of every document. */
async function watchLayoutShift(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __e5Shift: number; __e5Shifts: string[] };
    w.__e5Shift = 0;
    w.__e5Shifts = [];
    type Shift = { value: number; hadRecentInput: boolean; startTime: number; sources: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
    const describe = (node?: Node) => {
      const el = node instanceof Element ? node : node?.parentElement;
      if (!el) return "?";
      const block = el.querySelector("[data-content-type]") ?? el.closest("[data-content-type]");
      const kind = block ? `[${block.getAttribute("data-content-type")} "${(block.textContent ?? "").slice(0, 24)}"]` : "";
      return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}${kind}`;
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Shift[]) {
          if (entry.hadRecentInput) continue;
          w.__e5Shift += entry.value;
          // Which elements moved, for the failure message.
          w.__e5Shifts.push(
            `${entry.value.toFixed(3)} at ${Math.round(entry.startTime)}ms: ` +
              entry.sources.map((s) => `${describe(s.node)} y ${Math.round(s.previousRect.y)}→${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}→${Math.round(s.currentRect.height)}`).join("; "),
          );
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Not Chromium: the test reads a missing total as a failure.
    }
  });
}

const layoutShift = (page: Page) => page.evaluate(() => (window as unknown as { __e5Shift?: number }).__e5Shift ?? Number.NaN);
const layoutShifts = (page: Page) => page.evaluate(() => (window as unknown as { __e5Shifts?: string[] }).__e5Shifts ?? []);

interface Timings {
  open: { startTime: number; detail: { objectPath: string; blocks: number } } | null;
  interactive: { startTime: number; detail: { objectPath: string; blocks: number } } | null;
}

function readMarks(page: Page): Promise<Timings> {
  return page.evaluate(() => {
    const last = (name: string) => {
      const entry = performance.getEntriesByName(name, "mark").at(-1) as PerformanceMark | undefined;
      return entry ? { startTime: entry.startTime, detail: entry.detail } : null;
    };
    return { open: last("qbbe-editor:open"), interactive: last("qbbe-editor:interactive") };
  });
}

async function openPage(page: Page, id: string) {
  await page.goto(`/pages/${id}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 30_000 });
}

const waitForMark = (page: Page, name: string) =>
  page.waitForFunction((mark) => performance.getEntriesByName(mark, "mark").length > 0, name, { timeout: 30_000 });

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  previous = sql(`select coalesce(string_agg(key || '=' || enabled, ',' order by key), '') from public.feature_flag where key in ${SWITCHES} and organization_id is null`);
  sql(`update public.feature_flag set enabled = true where key in ${SWITCHES} and organization_id is null`);
  // Rows for the view blocks to show.
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority)
    select m.organization_id, '${esc(RUN)} task ' || n, '${STAFF}', '${STAFF}', 'ready', 'medium'
    from public.organization_membership m cross join generate_series(1, 3) n
    where m.user_id = '${STAFF}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.page where title like '${esc(RUN)}%'`);
  sql(`delete from public.task where title like '${esc(RUN)}%'`);
  sql(`delete from public.editor_document where object_type = 'page' and object_id not in (select id from public.page)`);
  for (const pair of previous.split(",").filter(Boolean)) {
    const [key, enabled] = pair.split("=");
    sql(`update public.feature_flag set enabled = ${enabled === "true"} where key = '${key}' and organization_id is null`);
  }
});

test.beforeEach(async ({ page }) => {
  // Embeds point at YouTube; the tests never need the real frame.
  await page.route(/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\//, (route) => route.abort());
});

test("a 100-block page opens without layout shift and is editable within the budget [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("hundred", 100);
  await signIn(page, "staff");
  await watchLayoutShift(page);
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:interactive");
  // Let the views near the top load their rows before the shift is read.
  await expect(page.locator("[data-view-block]").first()).toBeVisible();
  await page.waitForTimeout(1_500);

  const marks = await readMarks(page);
  const shift = await layoutShift(page);
  test.info().annotations.push({
    type: "E5-1 budget",
    description: `open ${Math.round(marks.open!.startTime)} ms (budget ${OPEN_BUDGET_MS}), typing works ${Math.round(marks.interactive!.startTime)} ms (budget ${INTERACTIVE_BUDGET_MS}), layout shift ${shift.toFixed(4)}`,
  });
  console.log(`E5-1: ${test.info().annotations.at(-1)!.description}`);
  expect(shift, (await layoutShifts(page)).join("\n")).toBeLessThan(0.1);
  expect(marks.open!.startTime).toBeLessThan(OPEN_BUDGET_MS);
  expect(marks.interactive!.startTime).toBeLessThan(INTERACTIVE_BUDGET_MS);

  // Editable: typing lands in the page.
  const paragraph = page.locator(".bn-block-content[data-content-type='paragraph']").filter({ hasText: "Paragraph 2 of a long page" });
  const box = await paragraph.boundingBox();
  await paragraph.click({ position: { x: box!.width - 4, y: box!.height / 2 } });
  await page.keyboard.type(" Typed here.");
  await expect(paragraph).toContainText("fill a line. Typed here.");
});

test("the editor marks when it opened and when typing works, separately, for each page [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("marks", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:interactive");
  const marks = await readMarks(page);
  expect(marks.open!.detail).toEqual({ objectPath: `/pages/${id}`, blocks: 100 });
  expect(marks.interactive!.detail).toEqual({ objectPath: `/pages/${id}`, blocks: 100 });
  expect(marks.interactive!.startTime).toBeGreaterThanOrEqual(marks.open!.startTime);
  // One of each per editor.
  expect(await page.evaluate(() => performance.getEntriesByName("qbbe-editor:open", "mark").length)).toBe(1);

  // A page nobody can type in (in the trash, so read-only) opens, but never
  // claims typing works; its heavy blocks still wait.
  sql(`update public.page set deleted_at = now() where id = '${id}'`);
  await openPage(page, id);
  await expect(page.getByRole("textbox", { name: "Document content" })).toHaveAttribute("contenteditable", "false");
  await waitForMark(page, "qbbe-editor:open");
  await page.waitForTimeout(1_000);
  const readOnly = await readMarks(page);
  expect(readOnly.open!.detail.blocks).toBe(100);
  expect(readOnly.interactive).toBeNull();
  await expect(page.locator(".qbbe-lazy-block").first()).toBeAttached();
});

test("view blocks and embeds wait until near the screen, keep their space, and render when scrolled to [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const id = longPage("lazy", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");

  // Far down the page: still waiting, at the estimated size, with its name.
  const farView = page.locator(".qbbe-lazy-block[data-lazy-block='query']").filter({ hasText: "lazy view 82" });
  const farEmbed = page.locator(".qbbe-lazy-block[data-lazy-block='embed']").filter({ hasText: "E5test00092" });
  await expect(farView).toContainText("This view loads when you scroll to it.");
  await expect(farEmbed).toContainText("This embed loads when you scroll to it.");
  expect((await farView.boundingBox())!.height).toBeCloseTo(240, 0);
  expect((await farEmbed.boundingBox())!.height).toBeCloseTo(360, 0);
  // Near the top: rendered at once.
  await expect(page.locator("[data-view-block]").filter({ hasText: "lazy view 7" })).toBeVisible();

  // Scroll down step by step: everything renders, and nothing on screen jumps.
  const shiftBefore = await page.evaluate(() => {
    const w = window as unknown as { __e5ScrollShift: number };
    w.__e5ScrollShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.__e5ScrollShift += entry.value;
      }
    }).observe({ type: "layout-shift" });
    return w.__e5ScrollShift;
  });
  expect(shiftBefore).toBe(0);
  for (let step = 0; step < 40; step++) {
    const atEnd = await page.evaluate(() => {
      window.scrollBy(0, 400);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    });
    await page.waitForTimeout(120);
    if (atEnd) break;
  }
  await expect(page.locator(".qbbe-lazy-block")).toHaveCount(0);
  await expect(page.locator("[data-view-block]")).toHaveCount(4);
  await expect(page.locator(".bn-block-content[data-content-type='embed'] iframe")).toHaveCount(4);
  const scrollShift = await page.evaluate(() => (window as unknown as { __e5ScrollShift: number }).__e5ScrollShift);
  test.info().annotations.push({ type: "E5-2 scroll shift", description: scrollShift.toFixed(4) });
  expect(scrollShift).toBeLessThan(0.1);

  // Each block's rendered height is remembered: on the next visit it waits
  // at exactly that height, so rendering it moves nothing.
  await page.waitForTimeout(800);
  const rendered = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".bn-block-content[data-content-type='query']")].map((el) => {
      const style = getComputedStyle(el);
      return el.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    }),
  );
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");
  const lastView = page.locator(".qbbe-lazy-block[data-lazy-block='query']").filter({ hasText: "lazy view 82" });
  await expect(lastView).toBeAttached();
  expect(Math.abs((await lastView.boundingBox())!.height - rendered[3])).toBeLessThanOrEqual(1);
  const outer = page.locator(".bn-block-content[data-content-type='query']").nth(3);
  const waitingHeight = (await outer.boundingBox())!.height;
  await outer.scrollIntoViewIfNeeded();
  await expect(page.locator("[data-view-block]").filter({ hasText: "lazy view 82" })).toBeVisible();
  await expect(page.locator("[data-view-block]").filter({ hasText: "lazy view 82" }).getByRole("table")).toBeVisible();
  expect(Math.abs((await outer.boundingBox())!.height - waitingHeight)).toBeLessThanOrEqual(1);
});

test("typing at the end of a 500-block page is handled within 100 ms per key [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const id = longPage("five hundred", 500);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:interactive");
  expect((await readMarks(page)).open!.detail.blocks).toBe(500);

  const last = page.locator(".bn-block-content[data-content-type='paragraph']").filter({ hasText: "Paragraph 499 of a long page" });
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  await last.click({ position: { x: box!.width - 4, y: box!.height / 2 } });
  await page.waitForTimeout(500);
  // Event Timing: each key's time from the press until the next paint after
  // it was handled (entries under 16 ms are not reported, and pass).
  await page.evaluate(() => {
    const w = window as unknown as { __e5Keys: { name: string; duration: number }[] };
    w.__e5Keys = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (["keydown", "keypress", "beforeinput", "input", "keyup"].includes(entry.name)) w.__e5Keys.push({ name: entry.name, duration: entry.duration });
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);
  });
  const typed = " and the end still types quickly";
  await page.keyboard.type(typed, { delay: 60 });
  await expect(last).toContainText(`fill a line.${typed}`);
  await page.waitForTimeout(500);
  const keys = await page.evaluate(() => (window as unknown as { __e5Keys: { name: string; duration: number }[] }).__e5Keys);
  const keydowns = keys.filter((k) => k.name === "keydown");
  const slowest = Math.max(0, ...keys.map((k) => k.duration));
  test.info().annotations.push({ type: "E5-4 per key", description: `slowest ${slowest} ms over ${typed.length} keys (${keydowns.length} keydowns over 16 ms)` });
  console.log(`E5-4: slowest ${slowest} ms over ${typed.length} keys`);
  expect(slowest).toBeLessThanOrEqual(KEY_BUDGET_MS);
});

test("on a long page the sidebar stays the height of the screen, with its account menu in view [switches on]", async ({ page }) => {
  const id = longPage("sidebar", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");
  const sidebar = page.locator("aside.qbbe-sidebar");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(viewport.height * 3);
  for (const where of ["top", "bottom"] as const) {
    await page.evaluate((w) => window.scrollTo(0, w === "top" ? 0 : document.documentElement.scrollHeight), where);
    await expect.poll(async () => (await sidebar.boundingBox())!.y, where).toBe(0);
    expect((await sidebar.boundingBox())!.height, where).toBeLessThanOrEqual(viewport.height);
    await expect(sidebar.locator("nav > div").last(), `${where}: account menu`).toBeInViewport();
  }
});

test("waiting blocks are found by find in page and table of contents links still land on their heading [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("find", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");

  // Find in page (the same search the browser's Ctrl+F runs) reaches a
  // waiting block's words; the match scrolls it near the screen and it renders.
  const findInPage = (text: string) =>
    page.evaluate((needle) => {
      window.getSelection()?.removeAllRanges();
      return (window as unknown as { find(s: string, caseSensitive: boolean, backwards: boolean, wrap: boolean): boolean }).find(needle, false, false, true);
    }, text);
  // An embed's address.
  const embed = page.locator(".bn-block-content[data-content-type='embed']").nth(1);
  await expect(embed.locator(".qbbe-lazy-block")).toContainText("E5test00042");
  expect(await findInPage("E5test00042")).toBe(true);
  await expect(embed.locator("iframe")).toBeAttached();
  await expect(embed).toBeInViewport();
  // A view's title.
  await expect(page.locator(".qbbe-lazy-block").filter({ hasText: "find view 82" })).toBeAttached();
  expect(await findInPage("find view 82")).toBe(true);
  const view = page.locator("[data-view-block]").filter({ hasText: "find view 82" });
  await expect(view).toBeVisible();
  await expect(view).toBeInViewport();

  // A table of contents link past several waiting blocks lands on its
  // heading, and the heading stays there while the blocks around it render.
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");
  await expect(page.locator(".qbbe-lazy-block").first()).toBeAttached();
  await page.getByRole("navigation", { name: "Table of contents" }).getByRole("link", { name: "Section 90" }).click();
  const heading = page.locator(".bn-block-content[data-content-type='heading']").filter({ hasText: "Section 90" });
  await page.waitForTimeout(1_500);
  await expect(heading).toBeInViewport();
  const top = (await heading.boundingBox())!.y;
  expect(top).toBeGreaterThanOrEqual(-1);
  expect(top).toBeLessThan(200);
  await expect(page).toHaveURL(/#block-/);
});

test("a find in page match stays on screen while the blocks above it grow, even without the browser's scroll anchoring [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("hold", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:open");
  await expect(page.locator(".qbbe-lazy-block").filter({ hasText: "hold view 82" })).toBeAttached();
  // Chrome anchors scrolling to a visible node, but the waiting block it often
  // picks is replaced when it renders; switch anchoring off to make that case
  // certain rather than occasional.
  await page.addStyleTag({ content: "* { overflow-anchor: none !important; }" });
  const found = await page.evaluate(() =>
    (window as unknown as { find(s: string, a: boolean, b: boolean, c: boolean): boolean }).find("hold view 82", false, false, true),
  );
  expect(found).toBe(true);
  const block = page.locator(".bn-block-outer").filter({ has: page.locator("[data-view-block], .qbbe-lazy-block").filter({ hasText: "hold view 82" }) }).last();
  await expect(block).toBeInViewport();
  // The page above the match grows, as the blocks above do when they render.
  // (Inserted just above the editor: the editor removes nodes it did not draw.)
  await page.evaluate(() => {
    const editor = document.querySelector(".bn-container");
    const grown = document.createElement("div");
    grown.style.height = "2500px";
    editor?.parentElement?.insertBefore(grown, editor);
  });
  await page.waitForTimeout(500);
  await expect(block).toBeInViewport({ timeout: 1_000 });
});

test("copying a page puts the real blocks on the clipboard, not the waiting ones [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("copy", 100);
  await signIn(page, "staff");
  await openPage(page, id);
  await waitForMark(page, "qbbe-editor:interactive");
  await expect(page.locator(".qbbe-lazy-block").filter({ hasText: "E5test00092" })).toBeAttached();
  // Select from the first paragraph to the last without scrolling, so the
  // blocks far down stay waiting while the selection is copied.
  await page.locator(".bn-block-content[data-content-type='paragraph']").filter({ hasText: "Paragraph 1 of a long page" }).click();
  await page.evaluate(() => {
    const text = (n: number) =>
      [...document.querySelectorAll(".bn-block-content[data-content-type='paragraph'] p")].find((p) => p.textContent?.startsWith(`Paragraph ${n} of`))!.firstChild!;
    const last = text(99);
    window.getSelection()!.setBaseAndExtent(text(1), 0, last, last.textContent!.length);
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(200);
  // The copy event the browser sends for Ctrl+C (headless Chromium does not
  // send one for the key itself); the editor fills its clipboard data.
  const html = await page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector(".bn-editor")!.dispatchEvent(Object.defineProperty(new ClipboardEvent("copy", { bubbles: true, cancelable: true }), "clipboardData", { value: data }));
    return data.getData("text/html");
  });
  expect(html).toContain("Paragraph 99 of a long page");
  expect(html).not.toContain("qbbe-lazy-block");
  expect(html).toContain("youtube-nocookie.com/embed/E5test00092");
  expect(html).toContain("copy view 82");
  // Still waiting on the page itself.
  await expect(page.locator(".qbbe-lazy-block").filter({ hasText: "E5test00092" })).toBeAttached();
});

test("waiting blocks read well in French, at 320 px, from the keyboard and pass axe in both themes [switches on]", async ({ page, context }) => {
  test.setTimeout(180_000);
  const id = longPage("states", 100);
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/pages/${id}`);
  await expect(page.getByRole("textbox", { name: "Contenu du document" })).toBeVisible({ timeout: 30_000 });
  await waitForMark(page, "qbbe-editor:open");
  const waiting = page.locator(".qbbe-lazy-block[data-lazy-block='query']").filter({ hasText: "states view 82" });
  await expect(waiting).toContainText("Cette vue s’affiche quand vous défilez jusqu’à elle.");
  await expect(page.locator(".qbbe-lazy-block[data-lazy-block='embed']").last()).toContainText("Ce contenu intégré s’affiche quand vous défilez jusqu’à lui.");
  // Nothing in the editor is wider than the screen. (The page's comment tabs
  // below the editor overflow by 11 px at 320 px; that is the shared tabs
  // component, not this unit, and is reported in the PR.)
  const editorOverflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".qbbe-editor, .qbbe-editor *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`),
  );
  expect(editorOverflow).toEqual([]);
  const box = (await waiting.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
    const results = await new AxeBuilder({ page }).include(".qbbe-lazy-block").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${theme}: ${v.id}`)).toEqual([]);
  }

  // Keyboard only: moving the caret to the end of the page brings the last
  // blocks near the screen, and they render.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("textbox", { name: "Contenu du document" }).focus();
  await page.keyboard.press("Control+End");
  await expect(page.locator("[data-view-block]").filter({ hasText: "states view 82" })).toBeVisible();
});

test("with the editor switch off, a long page has no waiting blocks and no editor marks [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("off", 100);
  sql("update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null");
  try {
    await signIn(page, "staff");
    await page.goto(`/pages/${id}`);
    await expect(page.getByText("The page body opens here once the editor is turned on.")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.locator(".qbbe-lazy-block")).toHaveCount(0);
    const marks = await readMarks(page);
    expect(marks.open).toBeNull();
    expect(marks.interactive).toBeNull();
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_editor' and organization_id is null");
  }
});

test("someone who cannot open the page gets no editor, waiting blocks or marks [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const id = longPage("private", 100);
  sql(`update public.page set visibility = 'private' where id = '${id}'`);
  await signIn(page, "volunteer");
  await page.goto(`/pages/${id}`);
  await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
  await expect(page.locator(".qbbe-lazy-block")).toHaveCount(0);
  const marks = await readMarks(page);
  expect(marks.open).toBeNull();
});
