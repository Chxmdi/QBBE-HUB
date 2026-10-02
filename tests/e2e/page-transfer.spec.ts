import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit X1: page export (Markdown, zipped with one CSV per view block)
 * and import (Markdown or HTML into a new page), behind the wos_pages switch.
 * The editor and lens switches are turned on for this file too (the page body
 * and view blocks need them) and every switch is put back afterwards.
 */

const RUN = `X1E2E ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const SWITCHES = "('wos_pages', 'wos_editor', 'wos_lenses')";
const NOT_FOUND = "Not found — or not yours to see";
let previous = "";

const esc = (s: string) => s.replace(/'/g, "''");
const setPages = (on: boolean) =>
  sql(`update public.feature_flag set enabled = ${on} where key = 'wos_pages' and organization_id is null`);
const clearLimits = () => sql(`delete from public.rate_limit_counter where bucket like 'page:import:%' or bucket like 'page:export:%'`);

type Block = { type: string; props?: Record<string, unknown>; content?: unknown; children?: Block[] };
const txt = (text: string, styles?: Record<string, boolean>) => ({ type: "text", text, ...(styles ? { styles } : {}) });

/** The text blocks the round trip must keep. */
const TEXT_BLOCKS: Block[] = [
  { type: "heading", props: { level: 2 }, content: [txt("Agenda")] },
  { type: "paragraph", content: [txt("Read "), txt("before", { bold: true }), txt(" the "), txt("meeting", { italic: true }), txt(".")] },
  { type: "bulletListItem", content: [txt("Budget")], children: [{ type: "bulletListItem", content: [txt("Summer camp")] }] },
  { type: "numberedListItem", content: [txt("Open")] },
  { type: "numberedListItem", content: [txt("Close")] },
  { type: "checkListItem", props: { checked: true }, content: [txt("Minutes sent")] },
  { type: "checkListItem", props: { checked: false }, content: [txt("Book the room")] },
  { type: "quote", content: [txt("Each one, teach one.")] },
  { type: "codeBlock", props: { language: "sql" }, content: [txt("select count(*) from members;")] },
  {
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [{ type: "tableCell", content: [txt("Name")] }, { type: "tableCell", content: [txt("Role")] }] },
        { cells: [{ type: "tableCell", content: [txt("Ada")] }, { type: "tableCell", content: [txt("Chair")] }] },
      ],
    },
  },
];

function makePage(owner: string, title: string, visibility: "workspace" | "private", blocks: Block[]): string {
  const content = { version: 1, blocks };
  return sql(`
    with p as (
      insert into public.page (organization_id, title, visibility, created_by)
      select organization_id, '${esc(title)}', '${visibility}', '${owner}' from public.organization_membership where user_id = '${owner}'
      returning id, organization_id
    ), d as (
      insert into public.editor_document (object_id, object_type, organization_id, content, created_by)
      select id, 'page', organization_id, '${esc(JSON.stringify(content))}'::jsonb, '${owner}' from p
    )
    select id from p;
  `);
}

const viewBlock = (title: string): Block => ({
  type: "query",
  props: {
    preset: "my_open",
    spec: JSON.stringify({
      version: 2,
      source: { type: "task" },
      title,
      where: [{ path: "title", op: "starts_with", value: RUN }],
      sort: [{ path: "title", direction: "asc" }],
      fields: ["status"],
    }),
  },
});

const storedBlocks = (pageId: string): Block[] =>
  (JSON.parse(sql(`select content::text from public.editor_document where object_id = '${pageId}'`) || "{}") as { blocks?: Block[] }).blocks ?? [];

/** What must survive: types, levels, checks, languages, styled text and cell text; ids and empty paragraphs are not content. */
function canonical(blocks: Block[]): unknown[] {
  const runs = (items: unknown): string[] =>
    Array.isArray(items)
      ? items.map((item: { text?: string; styles?: Record<string, unknown>; content?: unknown }) =>
          item.content ? `link:${runs(item.content).join("")}` : `${item.text}|${Object.keys(item.styles ?? {}).filter((k) => item.styles![k] === true).sort().join(",")}`,
        )
      : [];
  return blocks
    .filter((b) => !(b.type === "paragraph" && runs(b.content).length === 0 && !b.children?.length))
    .map((b) => ({
      type: b.type,
      level: b.type === "heading" ? (b.props?.level ?? 1) : null,
      checked: b.type === "checkListItem" ? b.props?.checked === true : null,
      language: b.type === "codeBlock" ? (b.props?.language ?? null) : null,
      content:
        b.content && !Array.isArray(b.content)
          ? (b.content as { rows: { cells: (unknown[] | { content?: unknown })[] }[] }).rows.map((r) =>
              r.cells.map((c) => runs(Array.isArray(c) ? c : c.content).join("")),
            )
          : runs(b.content),
      children: canonical(b.children ?? []),
    }));
}

/** The files in a stored (uncompressed) zip, as the export writes it. */
function unzip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    files.set(name, bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size).toString("utf8"));
    at += 30 + nameLength + size;
  }
  return files;
}

async function exportPage(page: Page, title: string): Promise<{ name: string; bytes: Buffer }> {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: `Export ${title} as Markdown` }).click(),
  ]);
  return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) };
}

async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} — ${v.nodes[0]?.html?.slice(0, 160)}`);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    localStorage.setItem("qbbe-theme", value);
    document.documentElement.classList.toggle("dark", value === "dark");
  }, theme);
}

async function importFile(page: Page, area: "workspace" | "private", file: { name: string; mimeType: string; buffer: Buffer }) {
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await sidebar.getByRole("button", { name: area === "workspace" ? "Import a file as a workspace page" : "Import a file as a private page" }).click();
  const dialog = page.getByRole("dialog", { name: "Import a page" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("File to import").setInputFiles(file);
  await dialog.getByRole("button", { name: "Import the file" }).click();
  return dialog;
}

/** Calls an X1 route from inside the signed-in page, as the app does (same origin, the person's own cookies). */
function callRoute(page: Page, path: string, form?: { visibility: string; name: string; text: string }) {
  return page.evaluate(
    async ({ path, form }) => {
      let body: FormData | undefined;
      if (form) {
        body = new FormData();
        body.set("visibility", form.visibility);
        body.set("file", new File([form.text], form.name, { type: "text/markdown" }));
      }
      const response = await fetch(path, { method: "POST", body });
      return { status: response.status, body: await response.text() };
    },
    { path, form },
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  previous = sql(`select coalesce(string_agg(key || '=' || enabled, ',' order by key), '') from public.feature_flag where key in ${SWITCHES} and organization_id is null`);
  sql(`update public.feature_flag set enabled = true where key in ${SWITCHES} and organization_id is null`);
  clearLimits();
  // Tasks the view block lists: staff can open the first two, only the owner the third.
  sql(`
    insert into public.task (organization_id, title, created_by, requester_id, assignee_id, status, priority)
    select m.organization_id, v.title, m.user_id, m.user_id, v.assignee::uuid, 'ready', 'medium'
    from public.organization_membership m
    cross join (values ('${RUN} a staff one', '${STAFF}'), ('${RUN} b staff two', '${STAFF}'), ('${RUN} c owner only', '${OWNER}')) as v(title, assignee)
    where m.user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  const pages = `select id from public.page where title like '${RUN}%' or title like '%${RUN}'`;
  sql(`delete from public.audit_event where action = 'page_exported' and object_id in (${pages})`);
  sql(`delete from public.page where id in (${pages})`);
  sql(`delete from public.editor_document where object_type = 'page' and object_id not in (select id from public.page)`);
  sql(`delete from public.task where title like '${RUN}%'`);
  clearLimits();
  for (const pair of previous.split(",").filter(Boolean)) {
    const [key, enabled] = pair.split("=");
    sql(`update public.feature_flag set enabled = ${enabled === "true"} where key = '${key}' and organization_id is null`);
  }
});

test("Export downloads the page as Markdown that imports back into the same blocks [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `${RUN} handbook`;
  const pageId = makePage(STAFF, title, "workspace", TEXT_BLOCKS);
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible({ timeout: 30_000 });

  const file = await exportPage(page, title);
  expect(file.name).toMatch(/^x1e2e-[a-z0-9]+-handbook-\d{4}-\d{2}-\d{2}\.md$/);
  const markdown = file.bytes.toString("utf8");
  expect(markdown).toContain(`# ${title}\n\n## Agenda\n\nRead **before** the *meeting*.\n\n- Budget\n  - Summer camp\n1. Open\n2. Close\n- [x] Minutes sent\n- [ ] Book the room\n\n> Each one, teach one.\n\n\`\`\`sql\nselect count(*) from members;\n\`\`\`\n\n| Name | Role |\n| --- | --- |\n| Ada | Chair |\n`);
  await expect(page.getByRole("status").filter({ hasText: `Export downloaded: ${file.name}` })).toBeVisible();
  expect(sql(`select count(*) from public.audit_event where action = 'page_exported' and object_id = '${pageId}' and actor_id = '${STAFF}'`)).toBe("1");

  // The file imports back as a new page with the same blocks.
  const dialog = await importFile(page, "workspace", { name: file.name, mimeType: "text/markdown", buffer: file.bytes });
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page).not.toHaveURL(new RegExp(pageId), { timeout: 30_000 });
  const importedId = /\/pages\/([0-9a-f-]{36})/.exec(page.url())![1];
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(title);
  await expect(page.getByRole("heading", { name: "Agenda" })).toBeVisible({ timeout: 30_000 });
  expect(canonical(storedBlocks(importedId))).toEqual(canonical(TEXT_BLOCKS));
});

test("view blocks export as CSV files zipped with the Markdown, holding only the exporter's rows [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `${RUN} tracker`;
  const pageId = makePage(STAFF, title, "workspace", [
    { type: "paragraph", content: [txt("Our open work:")] },
    viewBlock("Open work"),
  ]);

  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  await expect(page.locator("[data-view-block]")).toBeVisible({ timeout: 30_000 });
  const staffFile = await exportPage(page, title);
  expect(staffFile.name).toMatch(/\.zip$/);
  const staffZip = unzip(staffFile.bytes);
  const [markdownName, csvName] = [...staffZip.keys()];
  expect(csvName).toBe("views/01-open-work.csv");
  expect(staffZip.get(markdownName)).toBe(`# ${title}\n\nOur open work:\n\n[Open work](views/01-open-work.csv)\n`);
  const staffCsv = staffZip.get(csvName)!;
  expect(staffCsv).toContain(`${RUN} a staff one`);
  expect(staffCsv).toContain(`${RUN} b staff two`);
  expect(staffCsv).not.toContain("owner only");
  expect(staffCsv.trim().split("\r\n")).toHaveLength(3);

  // The owner exporting the same page gets the row only they can open.
  await page.context().clearCookies();
  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);
  await expect(page.locator("[data-view-block]")).toBeVisible({ timeout: 30_000 });
  const ownerCsv = unzip((await exportPage(page, title)).bytes).get(csvName)!;
  expect(ownerCsv).toContain(`${RUN} c owner only`);
  expect(ownerCsv.trim().split("\r\n")).toHaveLength(4);
});

test("Import turns Markdown and HTML files into new pages with unsafe HTML stripped, in English and French, by keyboard and at 320 px [switches on]", async ({ page, context }) => {
  test.setTimeout(240_000);
  const alerts: string[] = [];
  page.on("dialog", (d) => {
    alerts.push(d.message());
    void d.dismiss();
  });
  await signIn(page, "staff");
  await page.goto("/pages");

  // HTML with everything that must not survive.
  const html = `<html><head><title>Ignored</title><script>alert("evil")</script></head><body>
    <h1>Unsafe ${RUN}</h1><h2 onclick="alert(1)">Safe heading</h2>
    <p>Hello <img src=x onerror="alert(2)"><a href="javascript:alert(3)">click</a> <a href="https://example.org">site</a></p>
    <iframe src="https://example.org"></iframe><ul><li>Item <b>bold</b></li></ul><style>*{display:none}</style></body></html>`;
  let dialog = await importFile(page, "workspace", { name: "unsafe.html", mimeType: "text/html", buffer: Buffer.from(html) });
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: "Page title" })).toHaveValue(`Unsafe ${RUN}`, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Safe heading" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "site" })).toBeVisible();
  const unsafeId = /\/pages\/([0-9a-f-]{36})/.exec(page.url())![1];
  const stored = sql(`select content::text from public.editor_document where object_id = '${unsafeId}'`);
  expect(stored).not.toMatch(/script|javascript:|onerror|onclick|iframe|alert|display:none/i);
  expect(canonical(storedBlocks(unsafeId))).toEqual(
    canonical([
      { type: "heading", props: { level: 2 }, content: [txt("Safe heading")] },
      { type: "paragraph", content: [txt("Hello click "), { type: "link", content: [txt("site")] } as unknown as ReturnType<typeof txt>] },
      { type: "bulletListItem", content: [txt("Item "), txt("bold", { bold: true })] },
    ]),
  );
  expect(alerts).toEqual([]);

  // Keyboard only, in French: a Markdown file into the private area.
  await context.addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto("/pages");
  const importButton = page.getByRole("button", { name: "Importer un fichier comme page privée" });
  await importButton.focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", { name: "Importer une page" });
  await expect(dialog).toBeVisible();
  // The dialog opens on its close button; the file field is next.
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("Fichier à importer")).toBeFocused();
  await dialog.getByLabel("Fichier à importer").setInputFiles({
    name: "plan.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(`# Plan d’été ${RUN}\n\n- [ ] Réserver la salle\n\n> [!WARNING]\n> Date limite\n`),
  });
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Importer le fichier" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Titre de la page" })).toHaveValue(`Plan d’été ${RUN}`, { timeout: 30_000 });
  const planId = /\/pages\/([0-9a-f-]{36})/.exec(page.url())![1];
  expect(sql(`select visibility from public.page where id = '${planId}'`)).toBe("private");
  expect(canonical(storedBlocks(planId))).toEqual(
    canonical([
      { type: "checkListItem", props: { checked: false }, content: [txt("Réserver la salle")] },
      { type: "callout", content: [txt("Date limite")] },
    ]),
  );
  // The French export button, reached and run by keyboard.
  const exportButton = page.getByRole("button", { name: `Exporter Plan d’été ${RUN} en Markdown` });
  await exportButton.focus();
  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect((await readFile((await download.path())!)).toString("utf8")).toContain("- [ ] Réserver la salle\n\n> [!WARNING]\n> Date limite\n");
  await expect(exportButton).toBeFocused();

  // 320 px wide: the export button, the import buttons and the import dialog stay on screen and add no
  // sideways scroll, with no serious axe finding in either theme. (The pages screens themselves already
  // scroll sideways at 320 px when a sidebar title is long or the comments tabs show; that is outside X1.)
  await context.addCookies([{ name: "qbbe-locale", value: "en", url: new URL(page.url()).origin }]);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/pages/${planId}`);
  await expect(page.getByRole("button", { name: `Export Plan d’été ${RUN} as Markdown` })).toBeVisible({ timeout: 30_000 });
  /** X1's own controls (and the header row holding the export button) that reach past either edge or scroll inside. */
  const overflowing = () =>
    page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const mine = [
        ...document.querySelectorAll("[data-page-export], [data-page-import], dialog[open], dialog[open] *"),
        document.querySelector("[data-page-export]")?.parentElement,
      ].filter((el): el is Element => Boolean(el));
      return mine
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.left < -1 || box.right > width + 1 || el.scrollWidth > el.clientWidth + 1;
        })
        .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.className.toString().slice(0, 60)}`);
    });
  await expect.poll(overflowing).toEqual([]);
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page), `${theme}: page with export`).toEqual([]);
  }
  await setTheme(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Import a file as a workspace page" }).click();
  await page.setViewportSize({ width: 320, height: 700 });
  dialog = page.getByRole("dialog", { name: "Import a page" });
  await expect(dialog).toBeVisible();
  await expect.poll(overflowing).toEqual([]);
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page), `${theme}: import dialog`).toEqual([]);
  }
  await setTheme(page, "light");
});

test("export and import are refused without access, and imports are size- and rate-limited [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const workspaceId = makePage(STAFF, `${RUN} staff workspace`, "workspace", TEXT_BLOCKS);
  const privateId = makePage(STAFF, `${RUN} staff private`, "private", TEXT_BLOCKS);

  // A volunteer can read neither page, so neither exports; and cannot import into the workspace.
  await signIn(page, "volunteer");
  await page.goto("/pages");
  const sidebar = page.getByRole("navigation", { name: "Pages" });
  await expect(sidebar.getByRole("button", { name: "Import a file as a private page" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Import a file as a workspace page" })).toHaveCount(0);
  for (const id of [workspaceId, privateId]) {
    expect((await callRoute(page, `/api/pages/${id}/export`)).status).toBe(404);
  }
  const refused = await callRoute(page, "/api/pages/import", { visibility: "workspace", name: "a.md", text: "# Sneaky\n\nText" });
  expect(refused.status).toBe(403);
  expect(sql(`select count(*) from public.page where title = 'Sneaky'`)).toBe("0");
  expect(sql(`select count(*) from public.audit_event where action = 'page_exported' and object_id in ('${workspaceId}', '${privateId}')`)).toBe("0");

  // Staff: the owner of the private page exports it; files over 1 MB and other types are refused.
  await page.context().clearCookies();
  await signIn(page, "staff");
  expect((await callRoute(page, `/api/pages/${privateId}/export`)).status).toBe(200);
  // A page with nothing written yet exports as its title alone.
  const emptyId = sql(`
    insert into public.page (organization_id, title, visibility, created_by)
    select organization_id, '${RUN} empty', 'private', '${STAFF}' from public.organization_membership where user_id = '${STAFF}'
    returning id;
  `);
  expect(await callRoute(page, `/api/pages/${emptyId}/export`)).toEqual({ status: 200, body: `# ${RUN} empty\n` });
  const big = await callRoute(page, "/api/pages/import", { visibility: "private", name: "big.md", text: "a".repeat(1024 * 1024 + 1) });
  expect(big.status).toBe(413);
  const pdf = await callRoute(page, "/api/pages/import", { visibility: "private", name: "a.pdf", text: "%PDF" });
  expect(pdf.status).toBe(415);
  await page.goto("/pages");
  let dialog = await importFile(page, "private", { name: "big.md", mimeType: "text/markdown", buffer: Buffer.alloc(1024 * 1024 + 1, 97) });
  await expect(dialog.getByRole("alert")).toHaveText("This file is larger than 1 MB. Split it into smaller files and import each one.");
  await dialog.getByLabel("File to import").setInputFiles({ name: "notes.docx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await dialog.getByRole("button", { name: "Import the file" }).click();
  await expect(dialog.getByRole("alert")).toContainText("This kind of file cannot be imported.");
  await dialog.getByRole("button", { name: "Close dialog" }).click();

  // At the hourly ceiling, the next import is refused with when to try again, and nothing is created.
  sql(`
    insert into public.rate_limit_counter (bucket, window_start, count)
    values ('page:import:${STAFF}', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 20)
    on conflict (bucket, window_start) do update set count = 20;
  `);
  const before = sql(`select count(*) from public.page where created_by = '${STAFF}'`);
  dialog = await importFile(page, "private", { name: "late.md", mimeType: "text/markdown", buffer: Buffer.from(`# ${RUN} late\n`) });
  await expect(dialog.getByRole("alert")).toContainText(/try again/i);
  expect(sql(`select count(*) from public.page where created_by = '${STAFF}'`)).toBe(before);
  clearLimits();

  // A failed export says so and offers to try again; the retry downloads.
  await page.goto(`/pages/${workspaceId}`);
  let failures = 1;
  await page.route(`**/api/pages/${workspaceId}/export`, async (route) => {
    if (failures-- > 0) {
      // Slow enough to see the loading state.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.fulfill({ status: 500, body: "{}" });
    } else await route.continue();
  });
  const exportButton = page.getByRole("button", { name: `Export ${RUN} staff workspace as Markdown` });
  await exportButton.click();
  await expect(page.getByRole("status").filter({ hasText: "Preparing the export…" })).toBeAttached();
  await expect(exportButton).toHaveAttribute("aria-disabled", "true");
  const alert = page.getByRole("alert").filter({ hasText: "The export could not be made." });
  await expect(alert).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), alert.getByRole("button", { name: "Try the export again" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

test("export and import do not exist while the switch is off [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const pageId = makePage(STAFF, `${RUN} switched off`, "workspace", TEXT_BLOCKS);
  await signIn(page, "staff");
  setPages(false);
  try {
    await page.goto(`/pages/${pageId}`);
    await expect(page.getByRole("heading", { level: 1, name: NOT_FOUND })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Export / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Import a file/ })).toHaveCount(0);
    expect((await callRoute(page, `/api/pages/${pageId}/export`)).status).toBe(404);
    const imported = await callRoute(page, "/api/pages/import", { visibility: "private", name: "a.md", text: `# ${RUN} off\n` });
    expect(imported.status).toBe(404);
    expect(sql(`select count(*) from public.page where title = '${RUN} off'`)).toBe("0");
  } finally {
    setPages(true);
  }
});
