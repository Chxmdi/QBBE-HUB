import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit D3: charts, behind wos_lenses. A view block's "Chart" layout
 * draws bar, line, pie or a single number by its "Group by" and a total
 * (count, sum, average); a dashboard adds the same chart as a tile. Every
 * figure comes from lens_aggregate as the viewer, so two viewers of one
 * chart see their own numbers, and each chart has a table of its numbers.
 */

const RUN = `D3Chart ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const SWITCHES = "('wos_pages', 'wos_editor', 'wos_lenses')";
let previous = "";
let lensId = "";

const esc = (s: string) => s.replace(/'/g, "''");
const ours = [{ path: "title", op: "starts_with", value: `${RUN} ` }];

/** A page whose body is one view block with these props. */
function pageWithView(owner: string, title: string, visibility: "workspace" | "private", props: Record<string, unknown>): string {
  const content = {
    version: 1,
    blocks: [
      { type: "paragraph", content: [{ type: "text", text: "Above the chart" }] },
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

const chartPage = (title: string, extra: Record<string, unknown> = {}, owner = OWNER, visibility: "workspace" | "private" = "workspace") =>
  pageWithView(owner, `${RUN} ${title}`, visibility, { version: 2, source: { type: "task" }, layout: "chart", title: `${RUN} ${title}`, where: ours, groupBy: { path: "priority" }, ...extra });

const storedBlock = (pageId: string) =>
  JSON.parse(sql(`select b->'props'->>'spec' from public.editor_document, jsonb_array_elements(content->'blocks') b where object_id = '${pageId}' and b->>'type' = 'query'`));

async function viewBlock(page: Page, title: string): Promise<Locator> {
  const block = page.locator("[data-view-block]").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(block).toBeVisible({ timeout: 30_000 });
  return block;
}

/** The chart's table of numbers, row by row: "label=value". */
async function numbers(scope: Locator): Promise<string[]> {
  const table = scope.locator("table[data-chart-table]");
  await expect(table).toHaveCount(1, { timeout: 30_000 });
  return table.locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll("th, td")].slice(0, 2).map((cell) => cell.textContent?.trim()).join("=")),
  );
}

async function noSeriousAxe(page: Page, include: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    const results = await new AxeBuilder({ page }).include(include).analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious"), `${theme} theme`).toEqual([]);
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}

/** Server actions whose response is a chart's totals (the rows' action answers with rows, not measures). */
async function holdChartResponses(page: Page, handle: "abort" | Promise<void>) {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    if (!body.includes('"measures"')) return route.fulfill({ response, body });
    if (handle === "abort") return route.abort("failed");
    await handle;
    return route.fulfill({ response, body });
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  previous = sql(`select coalesce(string_agg(key || '=' || enabled, ',' order by key), '') from public.feature_flag where key in ${SWITCHES} and organization_id is null`);
  sql(`update public.feature_flag set enabled = true where key in ${SWITCHES} and organization_id is null`);
  // Five tasks: high 2 + 3.5 h, low 5 h, medium 1.5 h, high (no estimate).
  // The volunteer is on "four" (medium) and "five" (high) only.
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, estimate_hours)
    select m.organization_id, '${RUN} ' || v.n, '${OWNER}', v.assignee::uuid, v.status::public.task_status, v.priority::public.task_priority, v.estimate
    from public.organization_membership m
    cross join (values
      ('one', '${OWNER}', 'ready', 'high', 2.0),
      ('two', '${OWNER}', 'completed', 'high', 3.5),
      ('three', '${STAFF}', 'ready', 'low', 5.0),
      ('four', '${VOLUNTEER}', 'in_progress', 'medium', 1.5),
      ('five', '${VOLUNTEER}', 'ready', 'high', null)
    ) v(n, assignee, status, priority, estimate)
    where m.user_id = '${OWNER}';
  `);
  lensId = sql(`
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} lens', 'table', 'task',
      jsonb_build_object('version', 1, 'type', 'task',
        'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', '${RUN} ')))),
      'shared'
    from public.organization_membership where user_id = '${OWNER}'
    returning id;
  `);
});

test.afterAll(() => {
  sql(`delete from public.page where title like '${RUN}%'`);
  sql(`delete from public.editor_document where object_type = 'page' and object_id not in (select id from public.page)`);
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  for (const pair of previous.split(",").filter(Boolean)) {
    const [key, enabled] = pair.split("=");
    sql(`update public.feature_flag set enabled = ${enabled === "true"} where key = '${key}' and organization_id is null`);
  }
});

test("an editor turns a view into a bar, line, pie and single-number chart by count, sum and average, with a table of its numbers [switches on]", async ({ page }) => {
  test.setTimeout(240_000);
  const pageId = pageWithView(OWNER, `${RUN} build`, "workspace", { version: 2, source: { type: "task" }, layout: "table", title: `${RUN} build`, where: ours });
  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} build`);
  await expect(block.getByRole("table").getByRole("row")).toHaveCount(6, { timeout: 30_000 });

  /** Applies chart settings from the view settings panel, by keyboard-reachable controls. */
  const configure = async (kind: string, total: string, groupBy?: string) => {
    await block.getByRole("button", { name: "Configure view" }).click();
    const settings = block.getByRole("dialog", { name: "View settings" });
    await expect(settings.getByLabel("Layout")).toBeVisible({ timeout: 30_000 });
    await settings.getByLabel("Layout").selectOption({ label: "Chart" });
    await settings.getByLabel("Chart type").selectOption({ label: kind });
    await settings.getByLabel("Total").selectOption({ label: total });
    if (groupBy) await settings.getByLabel("Group by").selectOption({ label: groupBy });
    await settings.getByRole("button", { name: "Apply" }).click();
    await expect(settings).toHaveCount(0);
    await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  };

  // Bar chart of counts by priority.
  await configure("Bar chart", "Count of records", "Priority");
  const figure = block.getByRole("figure", { name: "Bar chart: Count by Priority" });
  await expect(figure).toBeVisible({ timeout: 30_000 });
  await expect(figure.locator("[data-chart-bar]")).toHaveCount(3);
  expect(await numbers(figure)).toEqual(["Low=1", "Medium=1", "High=3"]);
  expect(storedBlock(pageId)).toMatchObject({ layout: "chart", groupBy: { path: "priority" }, chart: { kind: "bar", total: "count" } });

  // D3-4: the numbers are a real table, opened from the keyboard.
  const toggle = figure.getByRole("button", { name: "Show the numbers" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(figure.getByRole("button", { name: "Hide the numbers" })).toHaveAttribute("aria-expanded", "true");
  await expect(figure.getByRole("table")).toBeVisible();
  await expect(figure.getByRole("row", { name: /High/ })).toContainText("3");
  await noSeriousAxe(page, "[data-view-block]");

  // Line chart of the sum of hours.
  await configure("Line chart", "Sum of Estimate (hours)");
  const line = block.getByRole("figure", { name: "Line chart: Sum of Estimate (hours) by Priority" });
  await expect(line).toBeVisible({ timeout: 30_000 });
  await expect(line.locator("[data-chart-point]")).toHaveCount(3);
  expect(await numbers(line)).toEqual(["Low=5", "Medium=1.5", "High=5.5"]);

  // Pie chart of the average.
  await configure("Pie chart", "Average of Estimate (hours)");
  const pie = block.getByRole("figure", { name: "Pie chart: Average of Estimate (hours) by Priority" });
  await expect(pie).toBeVisible({ timeout: 30_000 });
  await expect(pie.locator("[data-chart-slice]")).toHaveCount(3);
  expect(await numbers(pie)).toEqual(["Low=5", "Medium=1.5", "High=2.75"]);
  await noSeriousAxe(page, "[data-view-block]");

  // A single number: the count over every row.
  await configure("Single number", "Count of records");
  const one = block.getByRole("figure", { name: "Single number: Count" });
  await expect(one.locator("[data-chart-number]")).toHaveText("5", { timeout: 30_000 });
  expect(await numbers(one)).toEqual(["Count=5"]);
  expect(storedBlock(pageId)).toMatchObject({ chart: { kind: "number", total: "count" } });

  // It stays a chart after a reload.
  await page.reload();
  const again = await viewBlock(page, `${RUN} build`);
  await expect(again.locator("[data-chart-number]")).toHaveText("5", { timeout: 30_000 });
});

test("two readers of the same chart see only the records they can open, and page filters narrow it [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = chartPage("readers", { chart: { kind: "bar", total: "count" }, pageFilters: { enabled: true, paths: ["status"] } });

  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} readers`);
  const figure = block.getByRole("figure");
  expect(await numbers(figure)).toEqual(["Low=1", "Medium=1", "High=3"]);

  // A page-local filter (this tab only) narrows the totals like the rows.
  await block.getByLabel("Status").selectOption({ label: "Ready" });
  await expect.poll(() => numbers(block.getByRole("figure")), { timeout: 30_000 }).toEqual(["Low=1", "High=2"]);
  await block.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(() => numbers(block.getByRole("figure")), { timeout: 30_000 }).toEqual(["Low=1", "Medium=1", "High=3"]);

  // A staff member opens the same page: only the task they are on is counted.
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const theirs = await viewBlock(page, `${RUN} readers`);
  expect(await numbers(theirs.getByRole("figure"))).toEqual(["Low=1"]);
  await expect(theirs.locator("[data-chart-bar]")).toHaveCount(1);
});

test("a chart says when it is loading, failed (with a retry), empty or unusable, in English and French, at 320 px [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = chartPage("states", { chart: { kind: "pie", total: "count" } });
  await signIn(page, "owner");

  // Loading: the totals are held back until released.
  let release = () => {};
  await holdChartResponses(page, new Promise<void>((resolve) => (release = resolve)));
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} states`);
  await expect(block.getByRole("status").filter({ hasText: "Loading the chart…" })).toBeVisible({ timeout: 30_000 });
  release();
  await expect(block.getByRole("figure")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/*");

  // Error: the totals request fails; "Try again" asks again and draws it.
  await holdChartResponses(page, "abort");
  await page.reload();
  const failing = await viewBlock(page, `${RUN} states`);
  await expect(failing.getByRole("alert")).toHaveText(/This chart could not be loaded\./, { timeout: 30_000 });
  await page.unroute("**/*");
  await failing.getByRole("button", { name: "Try again" }).click();
  await expect(failing.getByRole("figure", { name: "Pie chart: Count by Priority" })).toBeVisible({ timeout: 30_000 });

  // Empty: nothing the reader can see matches.
  const emptyId = chartPage("empty", { where: [{ path: "title", op: "starts_with", value: `${RUN} nothing` }] });
  await page.goto(`/pages/${emptyId}`);
  const empty = await viewBlock(page, `${RUN} empty`);
  await expect(empty.getByText("Nothing to chart: no records you can see match this view.")).toBeVisible({ timeout: 30_000 });
  await expect(empty.getByRole("figure")).toHaveCount(0);

  // Unusable settings: a sum of text is never sent, and says why.
  const invalidId = chartPage("invalid", { chart: { kind: "bar", total: "sum", property: "title" } });
  await page.goto(`/pages/${invalidId}`);
  const invalid = await viewBlock(page, `${RUN} invalid`);
  await expect(invalid.getByRole("alert")).toHaveText(/A sum or an average needs a number property\./, { timeout: 30_000 });

  // French, at 320 px: no sideways scroll, every label translated.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.goto(`/pages/${pageId}`);
  const fr = await viewBlock(page, `${RUN} states`);
  const figure = fr.getByRole("figure", { name: "Graphique circulaire : Nombre par Priorité" });
  await expect(figure).toBeVisible({ timeout: 30_000 });
  await expect(figure.getByRole("button", { name: "Afficher les chiffres" })).toBeVisible();
  await figure.getByRole("button", { name: "Afficher les chiffres" }).click();
  expect(await numbers(figure)).toEqual(["Basse=1", "Moyenne=1", "Haute=3"]);
  // The chart block fits the screen and never scrolls sideways. (The page's
  // own tab bar, src/components/ui/tabs.tsx, bleeds 5 px at 320 px on every
  // page with or without a chart; that is reported in the PR, not D3's.)
  const fit = await fr.evaluate((el) => ({ right: el.getBoundingClientRect().right, scroll: el.scrollWidth, client: el.clientWidth, figure: el.querySelector("figure")!.scrollWidth - el.querySelector("figure")!.clientWidth }));
  expect(fit.right).toBeLessThanOrEqual(320);
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  expect(fit.figure).toBeLessThanOrEqual(0);
  await noSeriousAxe(page, "[data-view-block]");
  await page.goto(`/pages/${emptyId}`);
  await expect((await viewBlock(page, `${RUN} empty`)).getByText("Rien à afficher : aucun élément que vous pouvez voir ne correspond à cette vue.")).toBeVisible({ timeout: 30_000 });
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("a dashboard adds the same chart as a tile, with the same numbers for each viewer [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/lenses/dashboard");
  await page.getByLabel("Name").fill(`${RUN} board`);
  await page.getByRole("checkbox", { name: "Share with the organization" }).check();
  await page.getByRole("button", { name: "New dashboard" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${RUN} board` })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Edit tiles" }).click();

  const addChart = async (title: string, kind: string, total: string) => {
    await page.getByRole("button", { name: "Add a tile" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a tile" });
    await dialog.getByLabel("Tile").selectOption({ label: "Chart" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Records").selectOption({ label: `${RUN} lens` });
    await dialog.getByLabel("Chart type").selectOption({ label: kind });
    await dialog.getByLabel("Total").selectOption({ label: total });
    if (kind !== "Single number") await dialog.getByLabel("Group by").selectOption({ label: "Priority" });
    else await expect(dialog.getByLabel("Group by")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Dashboard saved." })).toHaveCount(1, { timeout: 15_000 });
  };
  await addChart("Hours by priority", "Pie chart", "Sum of Estimate (hours)");
  await addChart("How many", "Single number", "Count of records");

  const tile = (name: string) => page.locator("li[data-tile]").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const hours = tile("Hours by priority").getByRole("figure", { name: "Pie chart: Sum of Estimate (hours) by Priority" });
  await expect(hours).toBeVisible({ timeout: 30_000 });
  expect(await numbers(hours)).toEqual(["Low=5", "Medium=1.5", "High=5.5"]);
  await expect(tile("How many").locator("[data-chart-number]")).toHaveText("5", { timeout: 30_000 });

  // Kept with the dashboard.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await expect(tile("How many").locator("[data-chart-number]")).toHaveText("5", { timeout: 30_000 });
  const stored = sql(`select layout->'tiles' from public.lens where name = '${RUN} board'`);
  expect(JSON.parse(stored)).toMatchObject([
    { kind: "chart", groupBy: "priority", chart: { kind: "pie", total: "sum", property: "estimate" } },
    { kind: "chart", chart: { kind: "number", total: "count" } },
  ]);
  await noSeriousAxe(page, "main");

  // The volunteer opens the shared dashboard: only their own tasks count.
  const url = page.url();
  await page.context().clearCookies();
  await signIn(page, "volunteer");
  await page.goto(url);
  await expect(tile("How many").locator("[data-chart-number]")).toHaveText("2", { timeout: 30_000 });
  expect(await numbers(tile("Hours by priority").getByRole("figure"))).toEqual(["Medium=1.5", "High=No value"]);
});

test("with the lenses switch off, a chart view and the dashboards are not reachable [switch off]", async ({ page }) => {
  test.setTimeout(120_000);
  sql(`update public.feature_flag set enabled = false where key = 'wos_lenses' and organization_id is null`);
  try {
    const pageId = chartPage("off", { chart: { kind: "bar", total: "count" } });
    await signIn(page, "owner");
    await page.goto(`/pages/${pageId}`);
    await expect(page.getByText("Views are turned off for this workspace.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-chart]")).toHaveCount(0);
    await expect(page.locator("[data-chart-state]")).toHaveCount(0);
    await page.goto("/lenses/dashboard");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible({ timeout: 30_000 });
  } finally {
    sql(`update public.feature_flag set enabled = true where key = 'wos_lenses' and organization_id is null`);
  }
});
