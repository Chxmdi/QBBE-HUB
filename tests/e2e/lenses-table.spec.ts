import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M8b: the table lens, behind the wos_lenses switch. The switch
 * is turned on for this file only and restored afterwards, so other specs
 * still see the app as production does.
 */

const RUN = `LensE2E ${Date.now().toString(36)}`;
let previous = "f";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, estimate_hours)
    select m.organization_id, v.title, m.user_id, m.user_id, v.status::public.task_status, v.priority::public.task_priority, v.estimate
    from public.organization_membership m
    cross join (values
      ('${RUN} alpha', 'ready', 'high', 2.5),
      ('${RUN} beta', 'in_progress', 'low', 3),
      ('${RUN} gamma', 'ready', 'medium', null)
    ) as v(title, status, priority, estimate)
    where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

async function openTable(page: Page) {
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name: "Tasks table" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Search titles").fill(RUN);
  await expect(grid.getByRole("row")).toHaveCount(1 + 3 + 1, { timeout: 30_000 });
  return grid;
}

test("the owner reads, sums, groups and edits tasks in the table lens", async ({ page }) => {
  await signIn(page, "owner");
  const grid = await openTable(page);

  // Number totals over the loaded rows.
  const totals = grid.getByRole("row").last();
  await expect(totals).toContainText("Sum");
  await expect(totals).toContainText("5.5");

  // Keyboard: the header is the single tab stop; arrows move between cells.
  const header = grid.getByRole("columnheader", { name: /Title/ });
  await header.focus();
  await page.keyboard.press("ArrowDown");
  const firstTitle = grid.getByRole("row").nth(1).getByRole("gridcell").first();
  await expect(firstTitle).toBeFocused();
  await expect(firstTitle).toHaveText(`${RUN} alpha`);

  // Edit in place: Enter opens the editor, Enter saves.
  await page.keyboard.press("Enter");
  const editor = grid.getByRole("textbox", { name: "Edit Title" });
  await expect(editor).toBeFocused();
  await editor.fill(`${RUN} alpha renamed`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible({ timeout: 15_000 });
  await expect(firstTitle).toBeFocused();
  await expect
    .poll(() => sql(`select count(*) from public.task where title = '${RUN} alpha renamed'`), { timeout: 15_000 })
    .toBe("1");

  // Escape cancels without saving.
  await page.keyboard.press("Enter");
  await grid.getByRole("textbox", { name: "Edit Title" }).fill("should not save");
  await page.keyboard.press("Escape");
  await expect(firstTitle).toHaveText(`${RUN} alpha renamed`);

  // Status through a select, on the same row.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await grid.getByRole("combobox", { name: "Edit Status" }).selectOption({ label: "In review" });
  await page.keyboard.press("Enter");
  await expect
    .poll(() => sql(`select status from public.task where title = '${RUN} alpha renamed'`), { timeout: 15_000 })
    .toBe("in_review");

  // Group by status: a header row per group, with its count.
  await page.getByLabel("Group by").selectOption({ label: "Status" });
  await expect(grid.getByRole("gridcell", { name: /^Ready: 1/ })).toBeVisible({ timeout: 15_000 });
  await expect(grid.getByRole("gridcell", { name: /^In review: 1/ })).toBeVisible();
  await expect(grid.getByRole("gridcell", { name: /^In progress: 1/ })).toBeVisible();

  // Accessibility, in both themes.
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
});

test("columns can be hidden, moved and resized, and the layout is remembered", async ({ page }) => {
  await signIn(page, "owner");
  const grid = await openTable(page);

  await page.getByRole("button", { name: "Columns" }).click();
  await page.getByRole("checkbox", { name: "Reviewer" }).uncheck();
  await expect(grid.getByRole("columnheader", { name: /Reviewer/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Columns" }).click();

  // Move Priority left of Status from its menu, by keyboard.
  const priority = grid.getByRole("columnheader", { name: /Priority/ });
  await priority.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Options for the Priority column" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move left" }).click();
  const names = await grid.getByRole("columnheader").allInnerTexts();
  expect(names.findIndex((n) => n.includes("Priority"))).toBeLessThan(names.findIndex((n) => n.includes("Status")));

  // Resize with Alt+Arrow on a focused header.
  const before = (await priority.boundingBox())!.width;
  await priority.focus();
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => (await priority.boundingBox())!.width).toBeGreaterThan(before);

  // Sorting from the menu marks the header.
  await priority.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Sort descending" }).click();
  await expect(priority).toHaveAttribute("aria-sort", "descending");

  await page.reload();
  const again = page.getByRole("grid", { name: "Tasks table" });
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.getByRole("columnheader", { name: /Reviewer/ })).toHaveCount(0);
});

test("French labels, and a volunteer sees only their own rows", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name: "Tableau : Tâches" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Rechercher dans les titres").fill(RUN);
  // The fixture tasks are the owner's; the volunteer cannot read them.
  await expect(grid.getByText("Aucun élément ne correspond.")).toBeVisible({ timeout: 15_000 });
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("5,000 rows load in under a second", async ({ page }) => {
  sql(`
    insert into public.task (organization_id, title, created_by, status, priority, estimate_hours)
    select m.organization_id, '${RUN} bulk ' || g, m.user_id, 'ready', 'medium', 1
    from public.organization_membership m, generate_series(1, 5000) g
    where m.user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  `);
  await signIn(page, "owner");
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name: "Tasks table" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  // Let the unfiltered table finish loading first, so the timing is only
  // the filtered load.
  await expect(page.getByText(/^[\d,]+ rows?$/)).toBeVisible({ timeout: 30_000 });
  const count = page.getByText("5,000 rows", { exact: true });
  const started = await page.evaluate(() => performance.now());
  await page.getByLabel("Search titles").fill(`${RUN} bulk`);
  await expect(count).toBeVisible({ timeout: 30_000 });
  const elapsed = (await page.evaluate(() => performance.now())) - started;
  // The search waits 250 ms for typing to settle before it asks; that pause
  // is not load time.
  const loadMs = elapsed - 250;
  test.info().annotations.push({ type: "5,000-row load (ms)", description: String(Math.round(loadMs)) });
  expect(loadMs).toBeLessThan(1000);
  // Every row is reachable: Ctrl+End lands on the totals, which sum all 5,000.
  await grid.getByRole("columnheader").first().focus();
  await page.keyboard.press("Control+End");
  await expect(grid.getByRole("row").last()).toContainText("5,000");
});

test("with the switch off the table lens does not exist [switch off]", async ({ page }) => {
  sql("update public.feature_flag set enabled = false where key = 'wos_lenses'");
  try {
    await signIn(page, "staff");
    await page.goto("/lenses/table");
    await expect(page.getByRole("heading", { name: "Not found — or not yours to see" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("grid")).toHaveCount(0);
  } finally {
    sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  }
});
