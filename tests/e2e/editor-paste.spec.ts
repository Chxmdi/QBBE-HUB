import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Paste and Markdown shortcuts (wave 2 unit E1), on a page behind the
 * `wos_pages` and `wos_editor` switches: rich text, Markdown, spreadsheet
 * cells, files through the scanned upload, unsafe HTML, the line shortcuts
 * and pastes too large to save. Each test's page is created straight in the
 * database and removed afterwards.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const created: string[] = [];

test.afterAll(() => {
  if (created.length === 0) return;
  const ids = created.map((id) => `'${id}'`).join(",");
  // Storage may refuse deleting its rows from SQL; the files are tiny and local.
  try {
    sql(`delete from storage.objects where bucket_id = 'documents' and name in (select storage_path from public.document where title like 'e1-paste-%');`);
  } catch {
    // Left for the next database reset.
  }
  sql(`delete from public.document where title like 'e1-paste-%';`);
  sql(`delete from public.editor_document where object_id in (${ids});`);
  sql(`delete from public.page where id in (${ids});`);
});

/** A workspace page owned by staff, holding one paragraph per line. */
function makePage(title: string, lines: string[]): string {
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}' limit 1`);
  const pageId = sql(`insert into public.page (organization_id, title, created_by) values ('${org}', '${title}', '${STAFF}') returning id;`);
  const content = JSON.stringify({
    version: 1,
    blocks: lines.map((text) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] })),
  });
  sql(`
    insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
    values ('${pageId}', 'page', '${org}', '${STAFF}', '${content}'::jsonb, '${lines.join("\n")}');`);
  created.push(pageId);
  return pageId;
}

async function openPage(page: Page, pageId: string, name = "Document content"): Promise<Locator> {
  await page.goto(`/pages/${pageId}`);
  const editor = page.getByRole("textbox", { name });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

/**
 * Clicks into a block and waits until the editor has taken the click. The
 * browser moves the caret at once but tells the editor (selectionchange) a
 * task later; keys pressed before that act where the caret was before, which
 * under load typed a line into the block above it.
 */
async function clickInto(block: Locator, options?: Parameters<Locator["click"]>[0]) {
  await block.click(options);
  await expect
    .poll(() => block.evaluate((el) => el.contains(document.getSelection()?.anchorNode ?? null)))
    .toBe(true);
  // The selectionchange task was queued before this one, so it has run.
  await block.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** Puts the caret at the end of a one-line block, then opens an empty line below it. */
async function newLineAfter(page: Page, block: Locator) {
  const box = await block.boundingBox();
  if (!box) throw new Error("block not visible");
  await clickInto(block, { position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
}

type PastedFile = { name: string; type: string; base64: string };

/** Pastes clipboard data into the editor, as the browser does for Ctrl+V. */
async function paste(editor: Locator, data: Record<string, string>, files: PastedFile[] = []) {
  await editor.evaluate(
    (el, { data, files }) => {
      const transfer = new DataTransfer();
      for (const [type, value] of Object.entries(data)) transfer.setData(type, value);
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], file.name, { type: file.type }));
      }
      el.dispatchEvent(Object.defineProperty(new ClipboardEvent("paste", { bubbles: true, cancelable: true }), "clipboardData", { value: transfer }));
    },
    { data, files },
  );
}

/** Each block's type, heading level, check state and text, in document order. */
const shape = (editor: Locator) =>
  editor.locator(".bn-block-content").evaluateAll((els) =>
    els.map((el) => {
      const type = el.getAttribute("data-content-type") ?? "";
      const level = el.querySelector("h1,h2,h3,h4,h5,h6")?.tagName ?? "";
      const box = el.querySelector<HTMLInputElement>("input[type='checkbox']");
      const text = (el.querySelector(".bn-inline-content")?.textContent ?? "").trim();
      return [type, level, box ? String(box.checked) : "", text].filter(Boolean).join("|");
    }),
  );

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

async function inBothThemes(page: Page, check: (theme: string) => Promise<void>) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await check(theme);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

// A 1×1 PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("rich text keeps headings, bold, italic, links, lists and quotes, and saves them [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste rich ${stamp}`, [`Start ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Start ${stamp}` }));
  await paste(editor, {
    "text/html":
      `<h1>Title ${stamp}</h1><h3>Sub</h3><p>Plain <strong>bold</strong> <em>italic</em> <a href="https://example.org/guide">guide</a></p>` +
      `<ul><li>First</li><li>Second</li></ul><ol><li>Step</li></ol><blockquote><p>Wise words</p></blockquote>`,
    "text/plain": `Title ${stamp}\nSub\nPlain bold italic guide\nFirst\nSecond\nStep\nWise words`,
  });
  await expect(editor.locator("h1", { hasText: `Title ${stamp}` })).toBeVisible();
  await expect(editor.locator("h3", { hasText: "Sub" })).toBeVisible();
  await expect(editor.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(editor.locator("em", { hasText: "italic" })).toBeVisible();
  await expect(editor.locator("a[href='https://example.org/guide']", { hasText: "guide" })).toBeVisible();
  expect(await shape(editor)).toEqual([
    `paragraph|Start ${stamp}`,
    `heading|H1|Title ${stamp}`,
    "heading|H3|Sub",
    "paragraph|Plain bold italic guide",
    "bulletListItem|First",
    "bulletListItem|Second",
    "numberedListItem|Step",
    "quote|Wise words",
  ]);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select string_agg(type, ',' order by position) from public.block where object_id = '${pageId}' and depth = 0`)).toBe(
    "paragraph,heading,heading,paragraph,bulletListItem,bulletListItem,numberedListItem,quote",
  );
});

test("a paste and the typing after it can each be undone [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste undo ${stamp}`, [`Before ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);

  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Before ${stamp}` }));
  // Paste only once the new empty line exists and holds the caret, as a person would.
  await expect(editor.locator(".bn-block-content")).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? null)).toBe("");
  await paste(editor, { "text/plain": `# Pasted ${stamp}` });
  // Polled over the whole document, so a failure reports every block as it is.
  await expect.poll(async () => (await shape(editor)).join(" / ")).toContain(`heading|H1|Pasted ${stamp}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type(`Typed ${stamp}`);
  await expect(editor.getByText(`Typed ${stamp}`)).toBeVisible();

  // The paste handling is part of the editor from the start, so the undo
  // history keeps working: typing is undone first, then the paste.
  const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";
  await page.keyboard.press(undo);
  await expect(editor.getByText(`Typed ${stamp}`)).toHaveCount(0);
  await expect(editor.locator("[data-content-type='heading']", { hasText: `Pasted ${stamp}` })).toBeVisible();
  await expect.poll(async () => {
    await page.keyboard.press(undo);
    return editor.locator("[data-content-type='heading']", { hasText: `Pasted ${stamp}` }).count();
  }).toBe(0);
  await expect(editor.getByText(`Before ${stamp}`)).toBeVisible();
});

test("pasted Markdown becomes the same blocks as typing it [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const lines = [
    "# One",
    "## Two",
    "### Three",
    "#### Four",
    "##### Five",
    "###### Six",
    "- Dash item",
    "* Star item",
    "1. Numbered",
    "[] Open task",
    "> A quote",
    "---",
    ">! A callout",
  ];
  const expectedTyped = [
    "heading|H1|One",
    "heading|H2|Two",
    "heading|H3|Three",
    "heading|H4|Four",
    "heading|H5|Five",
    "heading|H6|Six",
    "bulletListItem|Dash item",
    "bulletListItem|Star item",
    "numberedListItem|Numbered",
    "checkListItem|false|Open task",
    "quote|A quote",
    "divider",
    "callout|A callout",
  ];
  const slots = lines.map((_, index) => `Slot ${index} ${stamp}`);
  const pageId = makePage(`Paste markdown ${stamp}`, [...slots, `Pasted below ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);

  // Typed: each line into its own emptied paragraph.
  for (const [index, line] of lines.entries()) {
    const slot = editor.locator("[data-content-type='paragraph']", { hasText: slots[index] });
    await clickInto(slot);
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(line);
    // The editor reads cursor moves a moment after the browser makes them, so
    // wait until this line has become its block before clicking the next one.
    await expect.poll(async () => (await shape(editor)).includes(expectedTyped[index])).toBe(true);
  }
  // Pasted: the same lines at once.
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Pasted below ${stamp}` }));
  await paste(editor, { "text/plain": lines.join("\n") });

  // Typing "---" leaves an empty line after the divider; empty lines are not content.
  const all = (await shape(editor)).filter((entry) => entry !== "paragraph");
  const marker = all.indexOf(`paragraph|Pasted below ${stamp}`);
  const typed = all.slice(0, marker);
  const pasted = all.slice(marker + 1);
  expect(typed).toEqual(expectedTyped);
  expect(pasted).toEqual(typed);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("spreadsheet cells, as text or as an HTML table, become a table with the same rows and columns [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste cells ${stamp}`, [`Start ${stamp}`, `Middle ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);
  const cells = (table: Locator) =>
    table.locator("tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll<HTMLElement>("td,th")].map((cell) => cell.innerText.trim())));

  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Start ${stamp}` }));
  await paste(editor, { "text/plain": `Name\tAmount\tNote\nAda\t12\t"two\nlines"\nGrace\t7\t\n` });
  const first = editor.locator("[data-content-type='table']").first();
  await expect(first).toBeVisible();
  expect(await cells(first)).toEqual([
    ["Name", "Amount", "Note"],
    ["Ada", "12", "two\nlines"],
    ["Grace", "7", ""],
  ]);

  // Google Sheets: its HTML table wins over the text.
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Middle ${stamp}` }));
  await paste(editor, {
    "text/html":
      `<google-sheets-html-origin><style>td{}</style><table><tbody><tr><td>City</td><td>Members</td></tr>` +
      `<tr><td>Montréal</td><td>40</td></tr><tr><td>Laval</td><td>12</td></tr></tbody></table>`,
    "text/plain": "City\tMembers\nMontréal\t40\nLaval\t12",
  });
  const second = editor.locator("[data-content-type='table']").nth(1);
  await expect(second).toBeVisible();
  expect(await cells(second)).toEqual([
    ["City", "Members"],
    ["Montréal", "40"],
    ["Laval", "12"],
  ]);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select count(*) from public.block where object_id = '${pageId}' and type = 'table'`)).toBe("2");
});

test("a pasted image uploads through the scanned upload and says while its scan is pending [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const name = `e1-paste-${stamp}.png`;
  const pageId = makePage(`Paste file ${stamp}`, [`Start ${stamp}`]);
  // A staff member: a file added in the editor follows its page, so anyone
  // who can edit the page can add one (not only administrators).
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);

  // First attempt: the storage upload fails, the block says so and offers to try again.
  let failNext = true;
  await page.route("**/storage/v1/object/documents/**", async (route) => {
    if (failNext && route.request().method() === "POST") {
      failNext = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"down"}' });
      return;
    }
    await route.continue();
  });
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Start ${stamp}` }));
  await paste(editor, { Files: "" }, [{ name, type: "image/png", base64: PNG }]);
  const image = editor.locator("[data-content-type='image']");
  await expect(image).toHaveCount(1);
  const failed = editor.locator("[data-upload-state='failed']");
  await expect(failed).toContainText(`${name} couldn't be uploaded.`);
  const retry = failed.getByRole("button", { name: "Try again" });
  await retry.focus();
  await page.keyboard.press("Enter");

  const pending = editor.locator("[data-upload-state='pending']");
  await expect(pending).toContainText(`Security check pending for ${name}`, { timeout: 30_000 });
  await expect(pending).toHaveAttribute("role", "status");
  const documentId = sql(`select id from public.document where title = '${name}'`);
  expect(documentId).toMatch(/^[0-9a-f-]{36}$/);
  expect(sql(`select scan_status || '|' || visibility from public.document where id = '${documentId}'`)).toBe("pending|staff");
  // The file belongs to the page it was pasted into: the page's readers read it.
  expect(sql(`select editor_object_type || ':' || editor_object_id from public.document where id = '${documentId}'`)).toBe(`page:${pageId}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select props->>'url' from public.block where object_id = '${pageId}' and type = 'image'`)).toBe(`qbbe-document:${documentId}`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await inBothThemes(page, async (theme) => {
    expect(await seriousAxe(page), `${theme}: pending note`).toEqual([]);
  });

  // The scan passes: the note goes away.
  sql(`update public.document set scan_status = 'clean' where id = '${documentId}'`);
  await expect(pending).toHaveCount(0, { timeout: 60_000 });
  await expect(image).toHaveCount(1);
  // And the image itself shows, from Storage, without a retry or a reload.
  await expect
    .poll(() => image.locator("img").evaluate((el) => (el as HTMLImageElement).naturalWidth).catch(() => 0), { timeout: 60_000 })
    .toBeGreaterThan(0);

  // A file that fails its scan says so, with nothing to retry.
  const second = `e1-paste-${stamp}-b.pdf`;
  // The image's own toolbar floats over the line above it: move by keyboard.
  await editor.focus();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("End");
  await paste(editor, { Files: "" }, [{ name: second, type: "application/pdf", base64: PNG }]);
  await expect(editor.locator("[data-upload-state='pending']")).toContainText(second, { timeout: 30_000 });
  sql(`update public.document set scan_status = 'rejected' where title = '${second}'`);
  const refused = editor.locator("[data-upload-state='refused']");
  await expect(refused).toContainText(`${second} did not pass the security check`, { timeout: 60_000 });
  await expect(refused).toHaveAttribute("role", "alert");
  await expect(refused.getByRole("button")).toHaveCount(0);

  // A file over 25 MB is left out, and the notice says only that.
  await editor.evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(25 * 1024 * 1024 + 1)], "e1-paste-huge.bin", { type: "application/octet-stream" }));
    el.dispatchEvent(Object.defineProperty(new ClipboardEvent("paste", { bubbles: true, cancelable: true }), "clipboardData", { value: transfer }));
  });
  const notice = page.getByTestId("editor-paste-too-large");
  await expect(notice).toContainText("A file was left out. Files can be at most 25 MB.");
  await expect(editor.locator("[data-content-type='file']")).toHaveCount(1);
});

test("unsafe HTML pastes as safe text only, and nothing runs [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste unsafe ${stamp}`, [`Start ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Start ${stamp}` }));
  const hostile =
    `<p onclick="window.__e1=1" onmouseover="alert('over')">Safe ${stamp} <a href="javascript:alert('link')">bad link</a> ` +
    `<a href="https://example.org/ok">good link</a></p><script>window.__e1=2;alert('script')</script>` +
    `<img src="x" onerror="window.__e1=3;alert('img')"><iframe src="javascript:alert('frame')"></iframe>` +
    `<svg onload="alert('svg')"><script>alert('svg2')</script></svg><style>body{display:none}</style>` +
    `<a href="data:text/html,<script>alert('data')</script>">data link</a>`;
  await paste(editor, { "text/html": hostile, "text/plain": `Safe ${stamp}` });
  // The editor's own clipboard format is cleaned too.
  await paste(editor, { "blocknote/html": `<p onmouseover="alert('bn')">Own ${stamp}</p><img src=x onerror="window.__e1=4">`, "text/html": `<p>Own ${stamp}</p>` });

  await expect(editor).toContainText(`Safe ${stamp} bad link good link`);
  await expect(editor).toContainText("data link");
  await expect(editor).toContainText(`Own ${stamp}`);
  await editor.locator("[data-content-type='paragraph']", { hasText: `Safe ${stamp}` }).hover();
  await editor.locator("[data-content-type='paragraph']", { hasText: `Safe ${stamp}` }).click();
  await page.waitForTimeout(500);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __e1?: number }).__e1)).toBeUndefined();
  await expect(editor.locator("script, iframe, svg[onload], img, [onclick], [onmouseover], [onerror]")).toHaveCount(0);
  await expect(editor.locator("a[href^='javascript'], a[href^='data']")).toHaveCount(0);
  await expect(editor.locator("a[href='https://example.org/ok']")).toHaveCount(1);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select (content::text ~* 'javascript|onerror|onclick|<script|alert')::text from public.editor_document where object_id = '${pageId}'`)).toBe("false");
});

test("every Markdown shortcut works when typed at the start of a line [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const cases: { typed: string; then?: string; expect: string }[] = [
    { typed: "# ", then: "H one", expect: "heading|H1|H one" },
    { typed: "## ", then: "H two", expect: "heading|H2|H two" },
    { typed: "### ", then: "H three", expect: "heading|H3|H three" },
    { typed: "#### ", then: "H four", expect: "heading|H4|H four" },
    { typed: "##### ", then: "H five", expect: "heading|H5|H five" },
    { typed: "###### ", then: "H six", expect: "heading|H6|H six" },
    { typed: "- ", then: "Dash", expect: "bulletListItem|Dash" },
    { typed: "* ", then: "Star", expect: "bulletListItem|Star" },
    { typed: "1. ", then: "First", expect: "numberedListItem|First" },
    { typed: "[] ", then: "Task", expect: "checkListItem|false|Task" },
    { typed: "> ", then: "Quoted", expect: "quote|Quoted" },
    { typed: "```", then: " ", expect: "codeBlock" },
    { typed: ">! ", then: "Heads up", expect: "callout|Heads up" },
    { typed: "---", expect: "divider" },
  ];
  const slots = cases.map((_, index) => `Line ${index} ${stamp}`);
  const pageId = makePage(`Shortcuts ${stamp}`, [...slots, `End ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);
  for (const [index, item] of cases.entries()) {
    await clickInto(editor.locator("[data-content-type='paragraph']", { hasText: slots[index] }));
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(item.typed);
    if (item.then) await page.keyboard.type(item.then);
  }
  const blocks = (await shape(editor)).filter((entry) => entry !== "paragraph");
  expect(blocks).toEqual([...cases.map((item) => item.expect), `paragraph|End ${stamp}`]);
  // The shortcut characters themselves are gone.
  await expect(editor.locator("[data-content-type='callout']")).not.toContainText(">!");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(sql(`select count(*) from public.block where object_id = '${pageId}' and type = 'callout'`)).toBe("1");
});

test("a paste larger than the editor can save shows the too-large state and the page keeps working [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste huge ${stamp}`, [`Start ${stamp}`]);
  await signIn(page, "staff");
  const editor = await openPage(page, pageId);
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Start ${stamp}` }));
  const before = await editor.locator(".bn-block-content").count();
  const started = Date.now();
  await editor.evaluate((el) => {
    const data = new DataTransfer();
    const line = "A long pasted line of text that keeps going. ";
    data.setData("text/plain", Array.from({ length: 40_000 }, () => line).join("\n"));
    data.setData("text/html", `<p>${line.repeat(40_000)}</p>`);
    el.dispatchEvent(Object.defineProperty(new ClipboardEvent("paste", { bubbles: true, cancelable: true }), "clipboardData", { value: data }));
  });
  const alert = page.getByTestId("editor-paste-too-large");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Nothing was pasted.");
  await expect(alert).toContainText("This is too large to save.");
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(await editor.locator(".bn-block-content").count()).toBe(before);

  // The page still answers: typing works at once.
  await page.keyboard.type(`Still typing ${stamp}`);
  await expect(editor).toContainText(`Still typing ${stamp}`);

  // Accessible, in both themes, and readable at 320 px without sideways scrolling.
  await page.evaluate(() => window.scrollTo(0, 0));
  await inBothThemes(page, async (theme) => {
    expect(await seriousAxe(page), `${theme}: too large`).toEqual([]);
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(alert).toBeVisible();
  // The notice wraps inside the editor's column and adds no width of its
  // own: the page is exactly as wide with it as without it. (At 320 px the
  // pages layout itself can be wider than the screen once the sidebar holds
  // long page titles; that is the shell's, not this notice's.)
  const noticeFits = () =>
    page.evaluate(() => {
      const notice = document.querySelector<HTMLElement>("[data-testid='editor-paste-too-large']")!;
      const column = document.querySelector<HTMLElement>(".qbbe-editor")!;
      return notice.scrollWidth <= notice.clientWidth && notice.getBoundingClientRect().right <= column.getBoundingClientRect().right + 0.5;
    });
  await expect.poll(noticeFits).toBe(true);
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  const withNotice = await pageWidth();
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await expect(alert).toHaveCount(0);
  expect(await pageWidth()).toBe(withNotice);
  await clickInto(editor.locator("[data-content-type='paragraph']", { hasText: `Still typing ${stamp}` }));
  await page.keyboard.press("End");
  await paste(editor, { "text/plain": "x".repeat(1_000_000) });
  await expect(alert).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });

  // Dismissed with the keyboard.
  await alert.getByRole("button", { name: "Dismiss" }).focus();
  await page.keyboard.press("Enter");
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
});

test("paste messages read in Quebec French [switches on]", async ({ page, context }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Coller ${stamp}`, [`Début ${stamp}`]);
  await signIn(page, "staff");
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  const editor = await openPage(page, pageId, "Contenu du document");
  await newLineAfter(page, editor.locator("[data-content-type='paragraph']", { hasText: `Début ${stamp}` }));
  await paste(editor, { "text/plain": "x".repeat(1_000_000) });
  const alert = page.getByTestId("editor-paste-too-large");
  await expect(alert).toContainText("Rien n'a été collé.");
  await expect(alert).toContainText("trop volumineux");
  await expect(alert.getByRole("button", { name: "Fermer" })).toBeVisible();
  await paste(editor, { "text/plain": "## Titre collé\n- Élément" });
  await expect(alert).toHaveCount(0);
  await expect(editor.locator("h2", { hasText: "Titre collé" })).toBeVisible();
  await expect(editor.locator("[data-content-type='bulletListItem']", { hasText: "Élément" })).toBeVisible();
});

test("with the editor switch off, there is no editor to paste into [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const pageId = makePage(`Paste off ${stamp}`, [`Body ${stamp}`]);
  sql("update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null;");
  try {
    await signIn(page, "staff");
    await page.goto(`/pages/${pageId}`);
    await expect(page.getByText("The page body opens here once the editor is turned on.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData("text/plain", "# Pasted with the switch off");
      document.body.dispatchEvent(Object.defineProperty(new ClipboardEvent("paste", { bubbles: true, cancelable: true }), "clipboardData", { value: data }));
    });
    await expect(page.getByText("Pasted with the switch off")).toHaveCount(0);
    await expect(page.getByTestId("editor-paste-too-large")).toHaveCount(0);
    expect(sql(`select count(*) from public.block where object_id = '${pageId}' and text like '%switch off%'`)).toBe("0");
  } finally {
    switches(true);
  }
});
