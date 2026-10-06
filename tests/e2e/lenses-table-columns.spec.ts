import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit D2: the table's totals row (count, empty, filled, sum, average,
 * minimum, maximum per column, from lens_aggregate over every matching row
 * the viewer can open), totals per group, the viewer's kept choice, and the
 * column entries owners and admins get to rename, hide and add columns for
 * everyone. Behind wos_lenses, turned on for this file and restored after.
 */

const RUN = `D2E2E ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
let previous = "f";

function cleanSettings() {
  sql(`delete from public.lens_totals_setting where type_key = 'task' and user_id in ('${OWNER}', '${VOLUNTEER}')`);
  sql(`delete from public.lens_column_setting where type_key = 'task'`);
}

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  cleanSettings();
  // 1,205 tasks (more than the table's 1,000-row page): estimate 1.5, empty
  // on every tenth; the first five are the volunteer's, the rest only the
  // owner can open.
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, estimate_hours)
    select m.organization_id, '${RUN} ' || lpad(g::text, 4, '0'), m.user_id,
           case when g <= 5 then '${VOLUNTEER}'::uuid else m.user_id end,
           case when g % 2 = 0 then 'ready'::public.task_status else 'in_progress'::public.task_status end,
           case when g % 10 = 0 then null else 1.5 end
    from public.organization_membership m, generate_series(1, 1205) g
    where m.user_id = '${OWNER}';
  `);
});

// Each test starts from the default totals.
test.beforeEach(() => {
  sql(`delete from public.lens_totals_setting where type_key = 'task' and user_id in ('${OWNER}', '${VOLUNTEER}')`);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  cleanSettings();
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

async function openTable(page: Page, search: string, name = "Tasks table", searchLabel = "Search titles") {
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(searchLabel).fill(search);
  return grid;
}

const totalCell = (page: Page, column: string) =>
  page.getByRole("grid").getByRole("gridcell", { name: new RegExp(`^(Totals\\. |Totaux\\. )?${column} ?:`) });

test("totals cover every matching row, not only the loaded page, and the viewer's choice is kept [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  // Only the first page of rows ever reaches the browser: later pages come
  // back empty, so a total computed from loaded rows would be wrong.
  await page.route("**/rest/v1/rpc/lens_query", async (route) => {
    const body = route.request().postDataJSON() as { spec?: { offset?: number } };
    if ((body?.spec?.offset ?? 0) === 0) return route.continue();
    const response = await route.fetch();
    const json = await response.json();
    return route.fulfill({ response, json: { ...json, rows: [] } });
  });
  const grid = await openTable(page, RUN);
  await expect(page.getByText("1,205 rows", { exact: true })).toBeVisible({ timeout: 30_000 });

  // D2-1: the count and sum are over all 1,205 rows (1,085 filled x 1.5).
  await expect(totalCell(page, "Title")).toHaveAccessibleName(/Title: Count 1,205$/, { timeout: 30_000 });
  const estimate = totalCell(page, "Estimate \\(hours\\)");
  await expect(estimate).toHaveAccessibleName("Estimate (hours): Sum 1,627.5");
  await expect(grid.getByRole("row").last()).toContainText("1,627.5");

  // Every kind offers its totals: a date column has earliest and latest, no sum.
  await totalCell(page, "Due").click();
  const dueMenu = page.getByRole("menu", { name: "Total for the Due column" });
  await expect(dueMenu.getByRole("menuitemradio")).toHaveText(["None", "Count", "Empty", "Filled", "Earliest", "Latest"]);
  await page.keyboard.press("Escape");
  await expect(dueMenu).toHaveCount(0);
  await expect(totalCell(page, "Due")).toBeFocused();

  // Keyboard only: Enter opens the estimate's menu, arrows move, Enter picks.
  await estimate.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Total for the Estimate (hours) column" });
  await expect(menu.getByRole("menuitemradio")).toHaveText(["None", "Count", "Empty", "Filled", "Sum", "Average", "Minimum", "Maximum"]);
  await expect(menu.getByRole("menuitemradio", { name: "Sum" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(estimate).toHaveAccessibleName("Estimate (hours): Average 1.5", { timeout: 15_000 });
  await expect(estimate).toBeFocused();

  // Empty and filled count every row, too.
  await estimate.click();
  await menu.getByRole("menuitemradio", { name: "Empty" }).click();
  await expect(estimate).toHaveAccessibleName("Estimate (hours): Empty 120", { timeout: 15_000 });
  await estimate.click();
  await menu.getByRole("menuitemradio", { name: "Average" }).click();
  await expect(estimate).toHaveAccessibleName("Estimate (hours): Average 1.5", { timeout: 15_000 });

  // D2-4: kept with the viewer's settings, across a reload.
  await expect
    .poll(() => sql(`select choices ->> 'estimate' from public.lens_totals_setting where user_id = '${OWNER}' and type_key = 'task'`), { timeout: 15_000 })
    .toBe("avg");
  await page.unroute("**/rest/v1/rpc/lens_query");
  await page.reload();
  await expect(page.getByRole("grid", { name: "Tasks table" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Search titles").fill(RUN);
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Average 1.5", { timeout: 30_000 });

  // Empty state: nothing matches, the count is 0 and the average has no value.
  await page.getByLabel("Search titles").fill(`${RUN} no such row`);
  await expect(totalCell(page, "Title")).toHaveAccessibleName(/Title: Count 0$/, { timeout: 30_000 });
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Average —");
});

test("two viewers get different totals, each over only the rows they can open [switches on]", async ({ page }) => {
  await signIn(page, "volunteer");
  await openTable(page, RUN);
  // The volunteer can open their five tasks only.
  await expect(totalCell(page, "Title")).toHaveAccessibleName(/Title: Count 5$/, { timeout: 30_000 });
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Sum 7.5");

  await signOut(page);
  await signIn(page, "owner");
  await openTable(page, RUN);
  await expect(totalCell(page, "Title")).toHaveAccessibleName(/Title: Count 1,205$/, { timeout: 30_000 });
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Sum 1,627.5");
});

test("totals follow the search and grouping, each group has its own totals, in French and at 320 px [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  const grid = await openTable(page, RUN);
  await expect(totalCell(page, "Title")).toHaveAccessibleName(/Count 1,205$/, { timeout: 30_000 });

  // A narrower search narrows the totals: "<run> 01" is 0100-0199 and 1000-1205 ... counted by the database.
  const narrower = `${RUN} 01`;
  const expected = Number(sql(`select count(*) from public.task where title like '${narrower}%'`));
  await page.getByLabel("Search titles").fill(narrower);
  await expect(totalCell(page, "Title")).toHaveAccessibleName(new RegExp(`Count ${expected.toLocaleString("en-US")}$`), { timeout: 30_000 });

  // Grouping: each group's totals, in a dialog the totals row opens.
  await page.getByLabel("Search titles").fill(RUN);
  await page.getByLabel("Group by").selectOption({ label: "Status" });
  await expect(grid.getByRole("gridcell", { name: /^Ready: 602/ })).toBeVisible({ timeout: 30_000 });
  const byGroup = grid.getByRole("button", { name: "Totals by group" });
  await expect(byGroup).toBeVisible({ timeout: 15_000 });
  await byGroup.click();
  const dialog = page.getByRole("dialog", { name: "Totals by group: Status" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("row", { name: /Ready/ })).toContainText("602");
  await expect(dialog.getByRole("row", { name: /Ready/ })).toContainText("723");
  await expect(dialog.getByRole("row", { name: /In progress/ })).toContainText("603");
  await expect(dialog.getByRole("row", { name: /In progress/ })).toContainText("904.5");

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("qbbe-theme", value);
      document.documentElement.classList.toggle("dark", value === "dark");
    }, theme);
    await page.waitForTimeout(200);
    const result = await new AxeBuilder({ page }).analyze();
    const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(violations, `${theme} theme: ${JSON.stringify(violations)}`).toEqual([]);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The same from the keyboard: the first totals cell's menu has the entry.
  await totalCell(page, "Title").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Totals by group" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");

  // 320 px: no horizontal page scroll with the menu open.
  await page.setViewportSize({ width: 320, height: 700 });
  await totalCell(page, "Title").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Total for the Title column" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 });

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  try {
    await openTable(page, RUN, "Tableau : Tâches", "Rechercher dans les titres");
    await expect(totalCell(page, "Titre")).toHaveAccessibleName(/^Totaux\. Titre : Nombre 1\s?205$/, { timeout: 30_000 });
    await expect(totalCell(page, "Estimation \\(heures\\)")).toHaveAccessibleName(/Somme 1\s?627,5$/);
  } finally {
    await page.context().clearCookies({ name: "qbbe-locale" });
  }
});

test("a failed total says so and can be retried, and shows that it is calculating [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  let fail = true;
  let hold: (() => void) | null = null;
  await page.route("**/rest/v1/rpc/lens_aggregate", async (route) => {
    if (fail) return route.fulfill({ status: 500, json: { message: "down" } });
    if (hold === null) {
      await new Promise<void>((resolve) => {
        hold = resolve;
      });
    }
    return route.continue();
  });
  await openTable(page, RUN);
  await expect(page.getByRole("status").filter({ hasText: "Totals could not be calculated." })).toBeAttached({ timeout: 30_000 });
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Sum —");
  fail = false;
  await page.getByRole("button", { name: "Retry totals" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Calculating totals…" })).toBeAttached({ timeout: 15_000 });
  await expect.poll(() => hold !== null, { timeout: 15_000 }).toBe(true);
  (hold as unknown as () => void)();
  await expect(totalCell(page, "Estimate \\(hours\\)")).toHaveAccessibleName("Estimate (hours): Sum 1,627.5", { timeout: 30_000 });
});

test("owners and admins rename, hide and add back a column for everyone; others get no such entries [switches on]", async ({ page }) => {
  await signIn(page, "owner");
  let grid = await openTable(page, RUN);

  // Rename Status from its column menu, by keyboard.
  const status = grid.getByRole("columnheader", { name: /^Status/ });
  await status.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Options for the Status column" });
  await menu.getByRole("menuitem", { name: "Rename column for everyone…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename the Status column" });
  await expect(rename).toBeVisible();
  await rename.getByLabel("Name in English").fill(`Stage ${RUN}`);
  await rename.getByLabel("Name in French").fill(`Étape ${RUN}`);
  await rename.getByRole("button", { name: "Save" }).click();
  await expect(rename).toHaveCount(0);
  await expect(grid.getByRole("columnheader", { name: `Stage ${RUN}` })).toBeVisible({ timeout: 15_000 });

  // Hide Priority for everyone.
  await grid.getByRole("columnheader", { name: /^Priority/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Hide column for everyone" }).click();
  await expect(grid.getByRole("columnheader", { name: /^Priority/ })).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(() => sql(`select hidden from public.lens_column_setting where type_key = 'task' and property_key = 'priority'`), { timeout: 15_000 })
    .toBe("t");
  // The title has no "hide for everyone".
  await grid.getByRole("columnheader", { name: /Title/ }).focus();
  await page.keyboard.press("Enter");
  const titleMenu = page.getByRole("menu", { name: "Options for the Title column" });
  await expect(titleMenu.getByRole("menuitem", { name: "Rename column for everyone…" })).toBeVisible();
  await expect(titleMenu.getByRole("menuitem", { name: "Hide column for everyone" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Someone else: sees the new name and no Priority, and has no such entries.
  await signOut(page);
  await signIn(page, "staff");
  grid = await openTable(page, RUN);
  await expect(grid.getByRole("columnheader", { name: `Stage ${RUN}` })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: /^Priority/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Columns" }).click();
  await expect(page.getByRole("checkbox", { name: "Priority" })).toHaveCount(0);
  await page.getByRole("button", { name: "Columns" }).click();
  await grid.getByRole("columnheader", { name: `Stage ${RUN}` }).focus();
  await page.keyboard.press("Enter");
  const staffMenu = page.getByRole("menu", { name: `Options for the Stage ${RUN} column` });
  await expect(staffMenu).toBeVisible();
  await expect(staffMenu.getByRole("menuitem", { name: /for everyone/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Back as the owner: add Priority back for everyone.
  await signOut(page);
  await signIn(page, "owner");
  grid = await openTable(page, RUN);
  await grid.getByRole("columnheader", { name: /Title/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Add a column for everyone…" }).click();
  const add = page.getByRole("dialog", { name: "Add a column" });
  await add.getByRole("button", { name: "Add Priority" }).click();
  await expect(add).toHaveCount(0);
  await expect(grid.getByRole("columnheader", { name: /^Priority/ })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => sql(`select hidden from public.lens_column_setting where type_key = 'task' and property_key = 'priority'`), { timeout: 15_000 })
    .toBe("f");
});

test("with the switch off there is no table, no totals and no column entries [switch off]", async ({ page }) => {
  sql("update public.feature_flag set enabled = false where key = 'wos_lenses'");
  try {
    await signIn(page, "owner");
    await page.goto("/lenses/table");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("grid")).toHaveCount(0);
    await expect(page.getByRole("gridcell", { name: /Totals/ })).toHaveCount(0);
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  }
});
