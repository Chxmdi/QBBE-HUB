import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";
import { setTheme } from "./theme";

/**
 * Wave 2 unit D4: the view block's timeline, gallery (with a cover) and feed
 * layouts. They use the block's shared settings and its one run, so each
 * shows exactly the rows the table shows, in the same order, under the same
 * conditions, sort and page-local filters.
 */

const RUN = `D4Layouts ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const SWITCHES = "('wos_pages', 'wos_editor', 'wos_lenses')";
let previous = "";

const esc = (s: string) => s.replace(/'/g, "''");

/** A page whose body is one view block with these props. */
function pageWithView(owner: string, title: string, visibility: "workspace" | "private", props: Record<string, unknown>): string {
  const content = {
    version: 1,
    blocks: [
      { type: "paragraph", content: [{ type: "text", text: "Above the view" }] },
      { type: "query", props: { preset: "my_open", spec: JSON.stringify(props) } },
      { type: "paragraph" },
    ],
  };
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

const storedBlock = (pageId: string) =>
  sql(`select b->'props'->>'spec' from public.editor_document, jsonb_array_elements(content->'blocks') b where object_id = '${pageId}' and b->>'type' = 'query'`);

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  previous = sql(`select coalesce(string_agg(key || '=' || enabled, ',' order by key), '') from public.feature_flag where key in ${SWITCHES} and organization_id is null`);
  sql(`update public.feature_flag set enabled = true where key in ${SWITCHES} and organization_id is null`);
  // one: a range; two: only a due date; three: only a start; four: no dates.
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, start_at, due_at, blocked_reason)
    select m.organization_id, '${RUN} ' || v.n, '${OWNER}', v.assignee::uuid, v.status::public.task_status, v.priority::public.task_priority,
      v.s::date, v.d::date, case when v.status = 'blocked' then 'Waiting on a signature' end
    from public.organization_membership m
    cross join (values
      ('one', '${OWNER}', 'ready', 'high', '2026-10-05', '2026-10-09'),
      ('two', '${OWNER}', 'blocked', 'low', null, '2026-10-20'),
      ('three', '${STAFF}', 'ready', 'medium', '2026-11-02', null),
      ('four', '${VOLUNTEER}', 'in_progress', 'medium', null, null)
    ) v(n, assignee, status, priority, s, d)
    where m.user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.page where title like '${RUN}%'`);
  sql(`delete from public.editor_document where object_type = 'page' and object_id not in (select id from public.page)`);
  sql(`delete from public.task where title like '${RUN}%'`);
  for (const pair of previous.split(",").filter(Boolean)) {
    const [key, enabled] = pair.split("=");
    sql(`update public.feature_flag set enabled = ${enabled === "true"} where key = '${key}' and organization_id is null`);
  }
});

async function viewBlock(page: Page, title: string) {
  const block = page.locator("[data-view-block]").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(block).toBeVisible({ timeout: 30_000 });
  return block;
}

/** The row ids a layout shows, in order (rows in tables, lists and timelines; cards in galleries). */
const shownIds = (block: Locator) =>
  block.locator("[data-view-row], [data-view-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-view-row") ?? el.getAttribute("data-view-card")));

async function chooseLayout(page: Page, block: Locator, layout: string, extra?: (settings: Locator) => Promise<void>) {
  await block.getByRole("button", { name: "Configure view" }).click();
  const settings = block.getByRole("dialog", { name: "View settings" });
  await expect(settings.getByLabel("Layout")).toBeVisible({ timeout: 30_000 });
  await settings.getByLabel("Layout").selectOption(layout);
  if (extra) await extra(settings);
  await settings.getByRole("button", { name: "Apply" }).click();
  await expect(settings).toHaveCount(0);
  await expect(block).toHaveAttribute("data-view-layout", layout);
  await expect(block.getByText("Loading…")).toHaveCount(0, { timeout: 30_000 });
}

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).include("[data-view-block]").analyze();
  return results.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/**
 * No sideways scroll from the block: it fits inside the screen and nothing in
 * it is wider than the block. (The page's own tab bar, outside the block, is
 * not this unit's and is reported separately.)
 */
async function noSidewaysScroll(page: Page, block: Locator) {
  return block.evaluate((root) => {
    const screen = document.documentElement.clientWidth;
    const box = root.getBoundingClientRect();
    const wider = [...root.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > box.right + 0.5).length;
    return { outsideScreen: Math.max(0, Math.ceil(box.right - screen)), wider, ownScroll: root.scrollWidth - root.clientWidth };
  });
}

test("timeline, gallery and feed show the table's rows in its order, under its filters, sort and page-local filters [switches on]", async ({ page }) => {
  test.setTimeout(300_000);
  const pageId = pageWithView(OWNER, `${RUN} page`, "workspace", {
    version: 2,
    source: { type: "task" },
    layout: "table",
    title: `${RUN} work`,
    where: [{ path: "title", op: "starts_with", value: RUN }],
    sort: [{ path: "priority", direction: "desc" }, { path: "title", direction: "asc" }],
    fields: ["status", "priority", "assignee"],
    pageFilters: { enabled: true, paths: ["status"] },
  });

  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} work`);
  await expect(block.getByRole("table").locator("[data-view-row]")).toHaveCount(4, { timeout: 30_000 });
  const tableOrder = await shownIds(block);
  const titleOf = (id: string | null) => sql(`select title from public.task where id = '${id}'`);
  // Priority high, then the two mediums by title, then low.
  expect(tableOrder.map(titleOf)).toEqual([`${RUN} one`, `${RUN} four`, `${RUN} three`, `${RUN} two`]);

  // D4-1: the timeline is offered in the shared settings, with its own date choices.
  await chooseLayout(page, block, "timeline", async (settings) => {
    await expect(settings.getByLabel("Bars start on")).toHaveValue("");
    await expect(settings.getByLabel("Bars start on").locator("option").first()).toHaveText("Automatic (Start)");
    await settings.getByLabel("Bars end on").selectOption("due");
  });
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(JSON.parse(storedBlock(pageId))).toMatchObject({ version: 2, layout: "timeline", timeline: { end: "due" }, sort: [{ path: "priority" }, { path: "title" }] });

  // D4-2: bars by start and end, missing dates said plainly, nothing dropped.
  const timeline = block.getByRole("list", { name: `${RUN} work timeline` });
  await expect(timeline.locator("[data-view-row]")).toHaveCount(4, { timeout: 30_000 });
  expect(await shownIds(block)).toEqual(tableOrder);
  await expect(timeline.getByRole("link", { name: `${RUN} one: Oct 5, 2026 to Oct 9, 2026` })).toBeVisible();
  await expect(timeline.getByRole("link", { name: `${RUN} two: ends Oct 20, 2026, no start date` })).toBeVisible();
  await expect(timeline.getByRole("link", { name: `${RUN} three: starts Nov 2, 2026, no end date` })).toBeVisible();
  await expect(timeline.getByRole("link", { name: `${RUN} four: no dates` })).toBeVisible();
  await expect(timeline.locator("[data-timeline-bar]")).toHaveCount(3);
  await expect(block.locator("[data-d4-range]")).toContainText("From Oct 4, 2026 to Nov 3, 2026");
  // A longer bar is wider than a one-day bar, and later dates sit further right.
  const barBox = async (title: string) => (await timeline.locator("[data-view-row]").filter({ hasText: title }).locator("[data-timeline-bar]").boundingBox())!;
  const one = await barBox(`${RUN} one`);
  const two = await barBox(`${RUN} two`);
  const three = await barBox(`${RUN} three`);
  expect(one.width).toBeGreaterThan(two.width * 3);
  expect(two.x).toBeGreaterThan(one.x + one.width);
  expect(three.x).toBeGreaterThan(two.x);

  // D4-2: keyboard only. One tab stop, arrows move, Home and End jump, Enter opens.
  const links = timeline.getByRole("link");
  await expect(links.nth(0)).toHaveAttribute("tabindex", "0");
  await links.nth(0).focus();
  await page.keyboard.press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(links.nth(3)).toBeFocused();
  await expect(links.nth(3)).toHaveAttribute("tabindex", "0");
  await expect(links.nth(0)).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowUp");
  await expect(links.nth(2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(links.nth(0)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(links.nth(0)).not.toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.nth(0)).toBeFocused();

  // D4-4 for the timeline: axe in both themes, then 320 px.
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page), `timeline ${theme}`).toEqual([]);
  }
  await setTheme(page, "light");

  // D4-3: a page-local filter narrows the timeline exactly as it narrows the table.
  await block.getByLabel("Status").selectOption("ready");
  await expect(timeline.locator("[data-view-row]")).toHaveCount(2, { timeout: 30_000 });
  const filtered = await shownIds(block);
  expect(filtered.map(titleOf)).toEqual([`${RUN} one`, `${RUN} three`]);
  await chooseLayout(page, block, "table");
  await expect(block.getByRole("table").locator("[data-view-row]")).toHaveCount(2, { timeout: 30_000 });
  expect(await shownIds(block)).toEqual(filtered);
  await block.getByRole("button", { name: "Clear filters" }).click();
  await expect(block.getByRole("table").locator("[data-view-row]")).toHaveCount(4, { timeout: 30_000 });

  // D4-1: the gallery with a cover property.
  await chooseLayout(page, block, "gallery", async (settings) => {
    await settings.getByLabel("Card cover").selectOption("status");
  });
  await expect(block.locator("[data-view-card]")).toHaveCount(4, { timeout: 30_000 });
  expect(await shownIds(block)).toEqual(tableOrder);
  await expect(block.locator('[data-view-cover="ready"]')).toHaveCount(2);
  await expect(block.locator('[data-view-cover="blocked"]')).toHaveCount(1);
  await expect(block.locator("[data-view-card]").filter({ hasText: `${RUN} two` })).toContainText("Blocked");
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(JSON.parse(storedBlock(pageId))).toMatchObject({ layout: "gallery", gallery: { cover: "status" } });
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page), `gallery ${theme}`).toEqual([]);
  }
  await setTheme(page, "light");

  // D4-1: the feed, placed by the last edit, in the table's order.
  await chooseLayout(page, block, "feed", async (settings) => {
    await expect(settings.getByLabel("Entries placed by").locator("option").first()).toHaveText("Automatic (Edited)");
  });
  const feed = block.getByRole("list", { name: `${RUN} work feed` });
  await expect(feed.locator("[data-view-row]")).toHaveCount(4, { timeout: 30_000 });
  expect(await shownIds(block)).toEqual(tableOrder);
  await expect(feed.getByRole("heading", { level: 4 }).first()).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    expect(await seriousAxe(page), `feed ${theme}`).toEqual([]);
  }
  await setTheme(page, "light");

  // D4-4: every layout at 320 px, no sideways scroll, rows still there.
  await page.setViewportSize({ width: 320, height: 800 });
  for (const layout of ["feed", "gallery", "timeline"]) {
    if (layout !== "feed") await chooseLayout(page, block, layout);
    await expect(block.locator("[data-view-row], [data-view-card]")).toHaveCount(4, { timeout: 30_000 });
    expect(await noSidewaysScroll(page, block), layout).toEqual({ outsideScreen: 0, wider: 0, ownScroll: 0 });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      expect(await seriousAxe(page), `${layout} ${theme} 320px`).toEqual([]);
    }
    await setTheme(page, "light");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("the layouts are in French, and a reader sees only their own rows in a timeline [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = pageWithView(VOLUNTEER, `${RUN} volunteer page`, "private", {
    version: 2,
    source: { type: "task" },
    layout: "timeline",
    title: `${RUN} everyone`,
    where: [{ path: "title", op: "starts_with", value: RUN }],
  });
  expect(sql(`select count(*) from public.task where title like '${RUN} %'`)).toBe("4");

  await signIn(page, "volunteer");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} everyone`);
  const timeline = block.getByRole("list", { name: `${RUN} everyone timeline` });
  await expect(timeline.locator("[data-view-row]")).toHaveCount(1, { timeout: 30_000 });
  await expect(timeline.getByRole("link", { name: `${RUN} four: no dates` })).toBeVisible();
  for (const other of ["one", "two", "three"]) await expect(block).not.toContainText(`${RUN} ${other}`);
  await expect(block.getByText("None of these records have dates yet.")).toBeVisible();

  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.reload();
  const fr = await viewBlock(page, `${RUN} everyone`);
  const frTimeline = fr.getByRole("list", { name: `Échéancier : ${RUN} everyone` });
  await expect(frTimeline.getByRole("link", { name: `${RUN} four : aucune date` })).toBeVisible({ timeout: 30_000 });
  await fr.getByRole("button", { name: "Configurer la vue" }).click();
  const settings = fr.getByRole("dialog", { name: "Paramètres de la vue" });
  await expect(settings.getByLabel("Disposition")).toBeVisible({ timeout: 30_000 });
  await expect(settings.getByLabel("Disposition").locator("option", { hasText: "Échéancier" })).toHaveCount(1);
  await expect(settings.getByLabel("Disposition").locator("option", { hasText: "Fil" })).toHaveCount(1);
  await expect(settings.getByLabel("Les barres commencent le")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("with the lenses switch off, no layout is drawn and nothing runs [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  const pageId = pageWithView(OWNER, `${RUN} off page`, "workspace", {
    version: 2,
    source: { type: "task" },
    layout: "timeline",
    title: `${RUN} off`,
    where: [{ path: "title", op: "starts_with", value: RUN }],
  });
  sql(`update public.feature_flag set enabled = false where key = 'wos_lenses' and organization_id is null`);
  try {
    await signIn(page, "owner");
    await page.goto(`/pages/${pageId}`);
    await expect(page.getByText("Above the view")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Views are turned off for this workspace.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-d4-timeline], [data-d4-feed], [data-view-cover]")).toHaveCount(0);
    await expect(page.locator("[data-view-block] [data-view-row]")).toHaveCount(0);
    await expect(page.getByText(`${RUN} one`)).toHaveCount(0);
  } finally {
    sql(`update public.feature_flag set enabled = true where key = 'wos_lenses' and organization_id is null`);
  }
});
