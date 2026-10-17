import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { useClipboard } from "./clipboard";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Code and media blocks, and block fallbacks (wave 2 unit E3), on pages behind
 * the `wos_pages` and `wos_editor` switches. Each test's page is written
 * straight to the database, so its blocks (including broken ones) are exact.
 * A trashed page opens read-only, which is how the read-only views are seen.
 */

const switches = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key in ('wos_pages', 'wos_editor') and organization_id is null;`);

test.describe.configure({ mode: "serial" });
test.beforeAll(() => switches(true));
test.afterAll(() => switches(false));

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const pagesMade: string[] = [];
test.afterAll(() => {
  if (pagesMade.length) {
    const ids = pagesMade.map((id) => `'${id}'`).join(",");
    sql(`delete from public.block where object_id in (${ids}); delete from public.editor_document where object_id in (${ids}); delete from public.page where id in (${ids});`);
  }
});

const text = (value: string) => [{ type: "text", text: value, styles: {} }];
const quote = (value: string) => value.replace(/'/g, "''");

/** A workspace page owned by staff, holding exactly these blocks. */
function makePage(title: string, blocks: object[]): string {
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}' limit 1`);
  const pageId = sql(
    `insert into public.page (organization_id, title, created_by, visibility) values ('${org}', '${title}', '${STAFF}', 'workspace') returning id;`,
  );
  pagesMade.push(pageId);
  const content = quote(JSON.stringify({ version: 1, blocks }));
  sql(`
    insert into public.editor_document (object_id, object_type, organization_id, created_by, content, content_text)
    values ('${pageId}', 'page', '${org}', '${STAFF}', '${content}'::jsonb, '${quote(title)}');`);
  return pageId;
}

/** Trashed pages open read-only. */
const trash = (pageId: string) => sql(`update public.page set deleted_at = now() where id = '${pageId}';`);

/** A block's saved props, read back from the database. */
const savedProps = (pageId: string, index: number) =>
  JSON.parse(sql(`select coalesce(content->'blocks'->${index}->'props', '{}'::jsonb)::text from public.editor_document where object_id = '${pageId}';`)) as Record<string, unknown>;

async function openPage(page: Page, pageId: string, signInFirst = true): Promise<Locator> {
  if (signInFirst) await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const editor = page.getByRole("textbox", { name: /^(Document content|Contenu du document)$/ });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return editor;
}

/** A click at the far right of a one-line block puts the caret after its last character. */
async function caretAtEnd(block: Locator) {
  const box = await block.boundingBox();
  if (!box) throw new Error("block not visible");
  await block.click({ position: { x: box.width - 4, y: box.height / 2 } });
}

async function seriousAxe(page: Page) {
  // Scanned from the top of the page: scrolled down, the sticky top bar covers
  // the sidebar rows behind it, and axe would report those as too small.
  await page.evaluate(() => window.scrollTo(0, 0));
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 160)} — ${n.failureSummary ?? ""}`));
}

async function axeInBothThemes(page: Page, what: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => {
      localStorage.setItem("qbbe-theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    expect(await seriousAxe(page), `${theme}: ${what}`).toEqual([]);
  }
}

const saved = (page: Page) => expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });

/** A 1×1 PNG, served for the test's secure image links. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const CODE = "const greet = (name) => {\n\tif (!name) return '<nobody>';\n  return `Hello, ${name}!`; // two spaces\n};\n";

test("code blocks have a named language picker and a copy button that copies the exact code [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Code ${stamp}`, [
    { type: "paragraph", content: text(`Intro ${stamp}`) },
    { type: "codeBlock", props: { language: "js" }, content: text(CODE) },
    { type: "paragraph", content: text(`After ${stamp}`) },
  ]);
  const editor = await openPage(page, pageId);
  const code = editor.locator("[data-content-type='codeBlock']").first();

  // The picker has a name, lists every required language, and reads "js" as JavaScript.
  const picker = code.getByRole("combobox", { name: "Code language" });
  await expect(picker).toHaveValue("javascript");
  const names = await picker.locator("option").allTextContents();
  for (const name of ["Plain text", "JavaScript", "TypeScript", "Python", "SQL", "JSON", "HTML", "CSS", "Bash"]) expect(names).toContain(name);

  // Choosing a language is saved with the block.
  await picker.selectOption("python");
  await saved(page);
  await expect.poll(() => savedProps(pageId, 1).language).toBe("python");
  await expect(code).toHaveAttribute("data-language", "python");

  // Copy puts the exact code on the clipboard (tabs, spaces, quotes, the final newline), from the keyboard too.
  const clipboard = await useClipboard(page);
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await picker.focus();
  await page.keyboard.press("Tab");
  await expect(code.getByRole("button", { name: "Copy code" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#qbbe-editor-live")).toHaveText("Code copied.");
  expect(await clipboard.read()).toBe(CODE);

  // A code block typed with the ``` shortcut gets the same controls; copy gives what was typed.
  await caretAtEnd(editor.locator("[data-content-type='paragraph']", { hasText: `After ${stamp}` }));
  await page.keyboard.press("Enter");
  await page.keyboard.type("``` ");
  const typed = editor.locator("[data-content-type='codeBlock']").nth(1);
  await expect(typed.getByRole("combobox", { name: "Code language" })).toHaveValue("text");
  await expect(typed).toContainText("Type or paste code here.");
  await page.keyboard.type("select 1;");
  await page.keyboard.press("Enter");
  await page.keyboard.type("select 2;");
  await expect(typed).not.toContainText("Type or paste code here.");
  await typed.getByRole("button", { name: "Copy code" }).click();
  expect(await clipboard.read()).toBe("select 1;\nselect 2;");
  await saved(page);

  await page.evaluate(() => window.scrollTo(0, 0));
  await axeInBothThemes(page, "code blocks");

  // Read-only: the language is shown as text, and copy still works.
  trash(pageId);
  await page.reload();
  const readOnly = page.getByRole("textbox", { name: "Document content" }).locator("[data-content-type='codeBlock']").first();
  await expect(readOnly).toContainText("Python", { timeout: 30_000 });
  await expect(readOnly.getByRole("combobox")).toHaveCount(0);
  await readOnly.getByRole("button", { name: "Copy code" }).click();
  expect(await clipboard.read()).toBe(CODE);
});

test("media blocks have a caption and a name, and an image without alt text asks for it [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("https://media.example.org/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const stamp = Date.now();
  const pageId = makePage(`Media ${stamp}`, [
    { type: "image", props: { url: "https://media.example.org/team.png", name: "team.png" } },
    { type: "video", props: { url: "https://media.example.org/clip.mp4", name: "clip.mp4", caption: "Launch clip" } },
    { type: "audio", props: { url: "https://media.example.org/talk.mp3", name: "talk.mp3" } },
    { type: "file", props: { url: "https://media.example.org/report.pdf", name: "report.pdf" } },
    { type: "paragraph", content: text(`End ${stamp}`) },
  ]);
  const editor = await openPage(page, pageId);

  // Each block is a figure named by what it is and what it shows.
  const image = editor.getByRole("figure", { name: "Image: team.png" });
  await expect(image).toBeVisible();
  await expect(editor.getByRole("figure", { name: "Video: clip.mp4" })).toBeVisible();
  await expect(editor.getByRole("figure", { name: "Audio: talk.mp3" })).toBeVisible();
  const file = editor.getByRole("figure", { name: "File: report.pdf" });
  await expect(file.getByRole("link", { name: "Open report.pdf" })).toHaveAttribute("href", "https://media.example.org/report.pdf");
  await expect(image.locator("img")).toHaveJSProperty("naturalWidth", 1);

  // The image asks for alt text until it has some; the alt text names it.
  const ask = image.getByRole("note").filter({ hasText: "This image has no description." });
  await expect(ask).toBeVisible();
  const alt = image.getByRole("textbox", { name: "Alt text" });
  await expect(alt).toHaveAttribute("aria-describedby", /.+/);
  await alt.fill("Three volunteers sorting food");
  await alt.press("Enter");
  await saved(page);
  await expect.poll(() => savedProps(pageId, 0).alt).toBe("Three volunteers sorting food");
  const described = editor.getByRole("figure", { name: "Image: Three volunteers sorting food" });
  await expect(described.getByRole("img", { name: "Three volunteers sorting food" })).toBeVisible();
  await expect(described.getByRole("note")).toHaveCount(0);

  // Every kind takes a caption; it is saved with the block.
  await expect(editor.getByRole("figure", { name: "Video: clip.mp4" }).getByRole("textbox", { name: "Caption" })).toHaveValue("Launch clip");
  const caption = file.getByRole("textbox", { name: "Caption" });
  await caption.fill("Annual report 2026");
  await caption.press("Tab");
  await saved(page);
  await expect.poll(() => savedProps(pageId, 3).caption).toBe("Annual report 2026");

  await page.evaluate(() => window.scrollTo(0, 0));
  await axeInBothThemes(page, "media blocks");

  // 320 px wide: nothing scrolls sideways.
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Read-only: captions show as captions, with no fields to edit.
  trash(pageId);
  await page.reload();
  const readOnly = page.getByRole("textbox", { name: "Document content" });
  await expect(readOnly.getByRole("figure", { name: "File: report.pdf" })).toContainText("Annual report 2026", { timeout: 30_000 });
  await expect(readOnly.locator("figcaption", { hasText: "Launch clip" })).toBeVisible();
  await expect(readOnly.getByRole("textbox", { name: "Caption" })).toHaveCount(0);
  await expect(readOnly.getByRole("img", { name: "Three volunteers sorting food" })).toBeVisible();
});

/** Half a second of video and of audio (WebM), so a block has something real to load. */
const CLIP = Buffer.from("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAMMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEcTbuMU6uEHFO7a1OsggL27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAgEAAAAAAABZUrmvBrgEAAAAAAAA414EBc8WIq1iFzB0P0QmcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4ImwgRC6gRCagQISVMNn+nNzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuMS4xMDBzc9VjwItjxYirWIXMHQ/RCWfIoEWjh0VOQ09ERVJEh5NMYXZjNjEuMy4xMDAgbGlidnB4Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC41MjAwMDAwMDAAH0O2dUFV54EAo7yBAACAsAIAnQEqEAAQAABHCIWFiIWEiAICAnWqA/gCDP0oAP7/TRL//FhX8WFfxYV/8WFf/PzO7cX85gCjlYEAKACxAQABEBAAGAAYWC/0AAgAAKOVgQBQALEBAAEQEAAYABhYL/QACAAAo5WBAHgAsQEAARAQABgAGFgv9AAIAACjlYEAoACxAQABEBAAGAAYWC/0AAgAAKOVgQDIALEBAAEQEAAYABhYL/QACAAAo5WBAPAAsQEAARAQABgAGFgv9AAIAACjlYEBGACxAQABEBAUYABhYL/QACAAAKOVgQFAALEBAAEQEAAYABhYL/QACAAAo5WBAWgAsQEAARAQABgAGFgv9AAIAACjlYEBkACxAQABEBAAGAAYWC/0AAgAAKOVgQG4ALEBAAEQEAAYABhYL/QACAAAo5WBAeAAsQEAARAQABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggGb8IED", "base64");
const TONE = Buffer.from("GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAANqEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggFATbuMU6uEHFO7a1OsggNU7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjEuMS4xMDBXQYxMYXZmNjEuMS4xMDBEiYhAc0AAAAAAABZUrmvlrgEAAAAAAABc14EBc8WIH/lQA2ptbZmcgQAitZyDdW5kiIEAhoZBX09QVVNWqoNjLqBWu4QExLQAg4EC4ZGfgQG1iEC/QAAAAAAAYmSBEGOik09wdXNIZWFkAQE4AUAfAAAAAAASVMNn+3Nzn2PAgGfImUWjh0VOQ09ERVJEh4xMYXZmNjEuMS4xMDBzc9ZjwItjxYgf+VADam1tmWfIoUWjh0VOQ09ERVJEh5RMYXZjNjEuMy4xMDAgbGlib3B1c2fIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDAuMzA4MDAwMDAwAB9DtnVBjueBAKOcgQAAgAiCiJArDx+XWFD3SN4bc9zf0yonWZQ5NaOagQAVgAijQOgDPDSiMmXbA23VrCwd97nPDYCjlIEAKYAInVXw5F373AbD3wcenDoQo5iBAD2ACJ1fsHcyqla9XLm3ClXeAnuqpRijlIEAUYAInV+wdzKqVpuYq+XgHa6oo5SBAGWACJ1fsHcvR45CodB1Q5eXtKOWgQB5gAidX7B3MqpcTnr6R+wYMC2IUKOWgQCNgAidB0Wj2/0/0RqvhNGrZ5HthKOVgQChgAickCvjTlp6JplPm9GjqDXAo5aBALWACJyQK+NLm1E4fmVGB3p2CD6Uo5aBAMmACJyQK+NNHRC1paCubRZQZ+jQo5eBAN2ACJyQK+NOWnoHfjj8IrT9YsT8LKOXgQDxgAicjJoEARkNuzgyZRJ2Fk2B62yjl4EBBYAInJAr405aeigYepsmp9SOY0mmo5aBARmACJyQK+NOWnr6inTo5g9IMvagoJmhkIEBLQAIgz6kgAm4rcjVFOh1ooQAzf5gHFO7a5G7j7OBALeK94EB8YIBwPCBAw==", "base64");

/** Whether the block's player has loaded the media far enough to play it. */
const playable = (block: Locator, tag: "video" | "audio") =>
  block.locator(tag).evaluate((el) => (el as HTMLMediaElement).readyState >= 1).catch(() => false);

/** Collects every resource the Content Security Policy refuses on this page. */
function refusals(page: Page): string[] {
  const refused: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) refused.push(message.text());
  });
  return refused;
}

test("video and audio actually play: https links, and a file added in the editor for another reader of the page [switches on]", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const refused = refusals(page);
  await page.route("https://media.example.org/**", (route) => {
    const audio = route.request().url().endsWith(".weba");
    return route.fulfill({ status: 200, contentType: audio ? "audio/webm" : "video/webm", body: audio ? TONE : CLIP });
  });
  const pageId = makePage(`Playback ${stamp}`, [
    { type: "video", props: { url: "https://media.example.org/clip.webm", name: "clip.webm" } },
    { type: "audio", props: { url: "https://media.example.org/tone.weba", name: "tone.weba" } },
    { type: "paragraph", content: text(`End ${stamp}`) },
  ]);
  const editor = await openPage(page, pageId);

  // Links: the browser loads both, and the security policy refuses neither.
  await expect.poll(() => playable(editor.getByRole("figure", { name: "Video: clip.webm" }), "video"), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => playable(editor.getByRole("figure", { name: "Audio: tone.weba" }), "audio"), { timeout: 30_000 }).toBe(true);

  // A video added in the editor: uploaded, scanned, then played from Storage.
  const name = `e3-play-${stamp}.webm`;
  await editor.locator("[data-content-type='paragraph']", { hasText: `End ${stamp}` }).click();
  await page.keyboard.press("End");
  await editor.evaluate((el, { name, base64 }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: "video/webm" }));
    el.dispatchEvent(Object.defineProperty(new ClipboardEvent("paste", { bubbles: true, cancelable: true }), "clipboardData", { value: transfer }));
  }, { name, base64: CLIP.toString("base64") });
  await expect(editor.locator("[data-upload-state='pending']")).toContainText(name, { timeout: 30_000 });
  const documentId = sql(`select id from public.document where title = '${name}'`);
  expect(sql(`select editor_object_type || ':' || editor_object_id from public.document where id = '${documentId}'`)).toBe(`page:${pageId}`);
  await saved(page);
  sql(`update public.document set scan_status = 'clean' where id = '${documentId}'`);
  const uploaded = editor.getByRole("figure", { name: `Video: ${name}` });
  await expect.poll(() => playable(uploaded, "video"), { timeout: 60_000 }).toBe(true);
  expect(refused).toEqual([]);

  // Another staff member who can read the page plays the same file.
  const other = await browser.newContext();
  const reader = await other.newPage();
  const readerRefused = refusals(reader);
  await signIn(reader, "pm");
  const readerEditor = await openPage(reader, pageId, false);
  await expect.poll(() => playable(readerEditor.getByRole("figure", { name: `Video: ${name}` }), "video"), { timeout: 60_000 }).toBe(true);
  expect(readerRefused).toEqual([]);
  await other.close();
});

test("a block that fails to render shows the fallback with Try again; the rest of the page keeps working and saving [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  // A damaged block: its file name is not text, so it cannot be drawn.
  const pageId = makePage(`Broken ${stamp}`, [
    { type: "paragraph", content: text(`Before ${stamp}`) },
    { type: "file", props: { url: "https://media.example.org/broken.pdf", name: { damaged: true } } },
    { type: "paragraph", content: text(`After ${stamp}`) },
  ]);
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("failed to render")) failures.push(message.text());
  });
  const editor = await openPage(page, pageId);

  const fallback = editor.getByRole("note", { name: "File block could not be shown" });
  await expect(fallback).toContainText("This block could not be shown. The rest of the page still works.");
  await expect(editor.locator("[data-content-type='paragraph']", { hasText: `Before ${stamp}` })).toBeVisible();
  const before = failures.length;
  expect(before).toBeGreaterThan(0);

  // Try again draws the block again (it is still damaged, so the fallback returns).
  await fallback.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => failures.length).toBeGreaterThan(before);
  await expect(fallback).toBeVisible();

  // The rest of the page is still editable and saves.
  await caretAtEnd(editor.locator("[data-content-type='paragraph']", { hasText: `After ${stamp}` }));
  await page.keyboard.type(" still saved");
  await saved(page);
  await expect
    .poll(() => sql(`select text from public.block where object_id = '${pageId}' and text like 'After%';`))
    .toBe(`After ${stamp} still saved`);
  await axeInBothThemes(page, "block fallback");
});

test("invalid or unsupported embeds and files show their own message and never break the page [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Refused ${stamp}`, [
    { type: "image", props: { url: "javascript:alert(1)", name: "x.png" } },
    { type: "file", props: { url: "http://insecure.example.org/a.pdf", name: "a.pdf" } },
    { type: "video", props: { url: "qbbe-document:00000000-0000-4000-8000-000000000000", name: "gone.mp4" } },
    { type: "embed", props: { url: "https://evil.example.org/frame" } },
    { type: "bookmark", props: { url: "javascript:alert(1)" } },
    { type: "image", props: { url: "https://media.example.org/missing.png", name: "missing.png" } },
    { type: "paragraph", content: text(`Still here ${stamp}`) },
  ]);
  await page.route("https://media.example.org/**", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
  page.on("dialog", (dialog) => {
    throw new Error(`a dialog opened: ${dialog.message()}`);
  });
  const editor = await openPage(page, pageId);

  const unsupported = "This address cannot be shown here. Use a file from the library or a secure link (https).";
  await expect(editor.getByRole("figure", { name: "Image: x.png" })).toContainText(unsupported);
  await expect(editor.getByRole("figure", { name: "File: a.pdf" })).toContainText(unsupported);
  await expect(editor.locator("img[src^='javascript']")).toHaveCount(0);
  const gone = editor.getByRole("figure", { name: "Video: gone.mp4" });
  await expect(gone).toContainText("This file is not available.");
  await gone.getByRole("button", { name: "Try again" }).click();
  await expect(gone).toContainText("This file is not available.");
  await expect(editor.locator("[data-content-type='embed']")).toContainText("This address can't be embedded");
  await expect(editor.locator("[data-content-type='embed'] iframe")).toHaveCount(0);
  await expect(editor.locator("[data-content-type='bookmark']")).toContainText("This link cannot be opened here.");
  await expect(editor.locator("a[href^='javascript']")).toHaveCount(0);
  // A secure link that does not load says so, with a way to try again.
  const missing = editor.getByRole("figure", { name: "Image: missing.png" });
  await expect(missing).toContainText("This image could not be loaded.");
  await missing.getByRole("button", { name: "Try again" }).click();
  await expect(missing).toContainText("This image could not be loaded.");
  await expect(editor.locator("[data-block-fallback]")).toHaveCount(0);

  await caretAtEnd(editor.locator("[data-content-type='paragraph']", { hasText: `Still here ${stamp}` }));
  await page.keyboard.type(" and saving");
  await saved(page);
  await axeInBothThemes(page, "refused files");

  trash(pageId);
  await page.reload();
  const readOnly = page.getByRole("textbox", { name: "Document content" });
  await expect(readOnly.getByRole("figure", { name: "Image: x.png" })).toContainText(unsupported, { timeout: 30_000 });
  await expect(readOnly.locator("[data-content-type='bookmark']")).toContainText("This link cannot be opened here.");
});

/** Every block type in the registry. Table, divider and columns are structure: never empty. */
const EMPTY_TYPES = [
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout",
  "codeBlock", "image", "file", "video", "audio", "bookmark", "embed", "tableOfContents",
  "task", "decision", "person", "status", "query", "libraryFile", "pageLink", "syncedBlock", "button",
];
const TEXT_TYPES = ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "toggleListItem", "quote", "callout"];
const EDIT_STATES: Record<string, string> = {
  codeBlock: "Type or paste code here.",
  image: "Upload an image or paste a link to one.",
  file: "Upload a file or paste a link to one.",
  video: "Upload a video or paste a link to one.",
  audio: "Upload an audio file or paste a link to one.",
  bookmark: "Link address",
  embed: "Address to embed",
  tableOfContents: "Add headings to see a table of contents",
  task: "Search tasks",
  decision: "Search decisions",
  person: "Search people",
  status: "On track",
  query: "My open tasks",
  libraryFile: "Search files",
  pageLink: "Search pages",
  syncedBlock: "New synced block",
  button: "Button label",
};
const READ_STATES: Record<string, string> = {
  codeBlock: "No code yet.",
  image: "No image added yet.",
  file: "No file added yet.",
  video: "No video added yet.",
  audio: "No audio added yet.",
  bookmark: "No link added yet.",
  embed: "Nothing embedded yet.",
  tableOfContents: "Add headings to see a table of contents",
  task: "Nothing chosen yet.",
  decision: "Nothing chosen yet.",
  person: "Nothing chosen yet.",
  status: "On track",
  query: "My open tasks",
  libraryFile: "Nothing chosen yet.",
  pageLink: "Nothing chosen yet.",
  syncedBlock: "Nothing chosen yet.",
  button: "isn't set up yet",
};

test("every block type has a readable empty state [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const pageId = makePage(`Empty ${stamp}`, EMPTY_TYPES.map((type) => ({ type })));
  const editor = await openPage(page, pageId);
  const blockOf = (type: string) => editor.locator(`.bn-block-content[data-content-type='${type}']`).first();

  // Text blocks say what to type once the cursor is in them.
  for (const type of TEXT_TYPES) {
    const block = blockOf(type);
    await block.locator(".bn-inline-content").click();
    await expect
      .poll(() => block.evaluate((el) => getComputedStyle(el, "::after").content), { message: `${type} placeholder` })
      .toMatch(/^".+"$/);
  }
  // Every other block says what to do next.
  // Each block is brought into view first: long pages draw view blocks only when they are near the screen (E5).
  for (const [type, words] of Object.entries(EDIT_STATES)) {
    await blockOf(type).scrollIntoViewIfNeeded();
    await expect(blockOf(type), type).toContainText(words);
  }

  // Read-only, an empty block says it is empty rather than showing nothing.
  trash(pageId);
  await page.reload();
  const readOnly = page.getByRole("textbox", { name: "Document content" });
  await expect(readOnly).toBeVisible({ timeout: 30_000 });
  for (const [type, words] of Object.entries(READ_STATES)) {
    const block = readOnly.locator(`.bn-block-content[data-content-type='${type}']`).first();
    await block.scrollIntoViewIfNeeded();
    await expect(block, type).toContainText(words);
  }
});

test("code and media blocks speak Québec French [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const pageId = makePage(`Français ${stamp}`, [
    { type: "codeBlock", props: { language: "text" }, content: text("echo bonjour") },
    { type: "image", props: { url: "https://media.example.org/photo.png", name: "" } },
    { type: "paragraph", content: text(`Fin ${stamp}`) },
  ]);
  await page.route("https://media.example.org/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await signIn(page, "staff");
  // The language choice is a cookie (as the settings screen sets it).
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: process.env.QA_BASE_URL ?? "http://127.0.0.1:3000" }]);
  const editor = await openPage(page, pageId, false);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr-CA");
  const picker = editor.getByRole("combobox", { name: "Langage du code" });
  await expect(picker.locator("option:checked")).toHaveText("Texte brut");
  await expect(editor.getByRole("button", { name: "Copier le code" })).toBeVisible();
  const image = editor.getByRole("figure", { name: "Image sans description" });
  await expect(image.getByRole("textbox", { name: "Texte de remplacement" })).toBeVisible();
  await expect(image.getByRole("textbox", { name: "Légende" })).toBeVisible();
  await expect(image).toContainText("Cette image n’a pas de description.");
});

test("with the switch off the code and media controls are not offered [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const pageId = makePage(`Off ${stamp}`, [
    { type: "codeBlock", props: { language: "python" }, content: text("print('hi')") },
    { type: "image", props: { url: "https://media.example.org/team.png", name: "team.png" } },
  ]);
  sql(`update public.feature_flag set enabled = false where key = 'wos_editor' and organization_id is null;`);
  try {
    await signIn(page, "staff");
    await page.goto(`/pages/${pageId}`);
    await expect(page.getByRole("heading", { name: `Off ${stamp}` })).toBeVisible({ timeout: 30_000 });
    // The page says its body waits for the editor, instead of loading one.
    await expect(page.getByText("The page body opens here once the editor is turned on.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Document content" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Code language" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy code" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Alt text" })).toHaveCount(0);
  } finally {
    switches(true);
  }
});
