import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS view engine UI (U13): the nested filter builder, multi-sort,
 * per-viewer settings on a shared lens, and bulk edit with undo. Needs the
 * wos_lenses and wos_objects switches; both are turned on for this file only
 * and restored afterwards.
 */

const RUN = `ViewEng ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const previous: Record<string, string> = {};

const SHARED_SPEC = {
  version: 1,
  type: "task",
  where: { and: [{ property: "title", operator: "contains", value: `${RUN} lens` }] },
  sort: [{ property: "title", direction: "asc" }],
  limit: 1000,
};

function addTasks(rows: { title: string; priority: string; assignee: string; reviewer?: string }[]) {
  const values = rows
    .map((r) => `('${r.title}', '${r.priority}', '${r.assignee}'::uuid, ${r.reviewer ? `'${r.reviewer}'::uuid` : "null::uuid"})`)
    .join(", ");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, reviewer_id, status, priority)
    select m.organization_id, v.title, m.user_id, v.assignee, v.reviewer, 'ready', v.priority::public.task_priority
    from public.organization_membership m
    cross join (values ${values}) as v(title, priority, assignee, reviewer)
    where m.user_id = '${OWNER}';
  `);
}

test.beforeAll(() => {
  for (const key of ["wos_lenses", "wos_objects"]) {
    previous[key] = sql(`select coalesce((select enabled from public.feature_flag where key = '${key}'), false)`);
    sql(`update public.feature_flag set enabled = true where key = '${key}'`);
  }
  addTasks([
    { title: `${RUN} lens alpha`, priority: "high", assignee: STAFF },
    { title: `${RUN} lens beta`, priority: "low", assignee: STAFF },
    { title: `${RUN} lens gamma`, priority: "medium", assignee: STAFF },
    { title: `${RUN} lens delta`, priority: "high", assignee: STAFF },
    { title: `${RUN} bulk one`, priority: "low", assignee: STAFF },
    { title: `${RUN} bulk two`, priority: "medium", assignee: STAFF },
    { title: `${RUN} bulk three`, priority: "high", assignee: STAFF },
    { title: `${RUN} vol own`, priority: "low", assignee: VOLUNTEER },
    { title: `${RUN} vol review`, priority: "low", assignee: STAFF, reviewer: VOLUNTEER },
  ]);
  sql(`
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} shared', 'table', 'task', '${JSON.stringify(SHARED_SPEC)}'::jsonb, 'shared'
    from public.organization_membership where user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  for (const [key, value] of Object.entries(previous)) {
    sql(`update public.feature_flag set enabled = ${value === "t" ? "true" : "false"} where key = '${key}'`);
  }
});

const lensId = () => sql(`select id from public.lens where name = '${RUN} shared'`);
const titlesIn = async (page: Page) => {
  const grid = page.getByRole("grid", { name: "Tasks table" });
  const cells = grid.getByRole("row").filter({ hasText: RUN }).locator('[role="gridcell"][aria-colindex="1"]');
  return (await cells.allInnerTexts()).map((s) => s.trim());
};

test("a nested filter with two sorts is kept per viewer and leaves the shared lens unchanged [switches on]", async ({ page }) => {
  const id = lensId();
  const specBefore = sql(`select spec::text from public.lens where id = '${id}'`);
  await signIn(page, "staff");
  await page.goto(`/lenses/table?lens=${id}`);
  const grid = page.getByRole("grid", { name: "Tasks table" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => titlesIn(page), { timeout: 30_000 }).toEqual([
    `${RUN} lens alpha`, `${RUN} lens beta`, `${RUN} lens delta`, `${RUN} lens gamma`,
  ]);

  // Build "(title contains …) and (priority is High or priority is Low)".
  await page.getByRole("button", { name: /^Filters/ }).click();
  const builder = page.getByRole("group", { name: "Filters" });
  await expect(builder.getByRole("combobox", { name: "Property" })).toHaveValue("title");
  await builder.getByRole("button", { name: "Add group" }).first().click();
  const inner = builder.locator('[data-filter-group="2"]');
  await expect(inner.getByLabel("Match")).toHaveValue("or");
  await inner.getByRole("button", { name: "Add condition" }).click();
  await inner.getByRole("combobox", { name: "Property" }).nth(0).selectOption({ label: "Priority" });
  await inner.getByRole("combobox", { name: "Value" }).nth(0).selectOption({ label: "High" });
  await inner.getByRole("button", { name: "Add condition" }).click();
  await inner.getByRole("combobox", { name: "Property" }).nth(1).selectOption({ label: "Priority" });
  await expect(inner.getByRole("combobox", { name: "Value" }).nth(1)).toHaveValue("low");
  await expect(builder).toContainText("3 of 49 conditions");
  await page.screenshot({ path: test.info().outputPath("filter-builder.png"), fullPage: true });

  const axe = await new AxeBuilder({ page }).include('[role="group"][aria-label="Filters"]').analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await builder.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("list", { name: "Active filters" })).toContainText("(Priority is High or Priority is Low)");

  // Two sorts: Priority descending, then Title descending (Shift adds a key).
  const priority = grid.getByRole("columnheader", { name: /Priority/ });
  const title = grid.getByRole("columnheader", { name: /Title/ });
  await priority.click();
  await expect(priority).toHaveAttribute("aria-sort", "ascending");
  await priority.click();
  await expect(priority).toHaveAttribute("aria-sort", "descending");
  await title.click({ modifiers: ["Shift"] });
  await title.click({ modifiers: ["Shift"] });
  await expect(title).toHaveAttribute("aria-sort", "descending");
  const sortChips = page.getByRole("list", { name: "Sort order" });
  await expect(sortChips.getByRole("listitem")).toHaveText([/1\. Priority, descending/, /2\. Title, descending/]);
  await expect.poll(() => titlesIn(page), { timeout: 15_000 }).toEqual([`${RUN} lens delta`, `${RUN} lens alpha`, `${RUN} lens beta`]);
  await page.screenshot({ path: test.info().outputPath("filtered-result.png"), fullPage: true });

  // Kept for this viewer only; the shared lens itself is unchanged.
  await expect(page.getByRole("status").filter({ hasText: "saved for you only" })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => sql(`select jsonb_array_length(sort) || ':' || ("where" -> 'and' -> 1 ? 'or')::text from public.lens_viewer_setting where lens_id = '${id}' and user_id = '${STAFF}'`), { timeout: 15_000 })
    .toBe("2:true");
  expect(sql(`select spec::text from public.lens where id = '${id}'`)).toBe(specBefore);
  expect(sql(`select count(*) from public.lens_viewer_setting where lens_id = '${id}'`)).toBe("1");

  // It comes back on the next visit.
  await page.reload();
  await expect(page.getByRole("grid", { name: "Tasks table" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => titlesIn(page), { timeout: 30_000 }).toEqual([`${RUN} lens delta`, `${RUN} lens alpha`, `${RUN} lens beta`]);
  await expect(page.getByRole("list", { name: "Sort order" }).getByRole("listitem")).toHaveCount(2);

  // "Reset to the shared lens" goes back to the owner's question.
  await page.getByRole("button", { name: "Reset to the shared lens" }).click();
  await expect.poll(() => titlesIn(page), { timeout: 15_000 }).toEqual([
    `${RUN} lens alpha`, `${RUN} lens beta`, `${RUN} lens delta`, `${RUN} lens gamma`,
  ]);
  await expect.poll(() => sql(`select count(*) from public.lens_viewer_setting where lens_id = '${id}'`), { timeout: 15_000 }).toBe("0");
  expect(sql(`select spec::text from public.lens where id = '${id}'`)).toBe(specBefore);
});

test("three selected rows are bulk edited and undone [switches on]", async ({ page }) => {
  const priorities = () => sql(`select string_agg(priority::text, ',' order by title) from public.task where title like '${RUN} bulk%'`);
  const before = priorities();
  expect(before).toBe("low,high,medium"); // one, three, two
  await signIn(page, "staff");
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name: "Tasks table" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Search titles").fill(`${RUN} bulk`);
  await expect.poll(() => titlesIn(page), { timeout: 30_000 }).toHaveLength(3);

  // Two by pointer, the third by keyboard (Space on the focused row).
  await grid.getByRole("checkbox", { name: `Select ${RUN} bulk one` }).check();
  await grid.getByRole("checkbox", { name: `Select ${RUN} bulk two` }).check();
  const third = grid.getByRole("row").filter({ hasText: `${RUN} bulk three` }).getByRole("gridcell").first();
  await grid.getByRole("columnheader", { name: /Title/ }).focus();
  await page.keyboard.press("ArrowDown");
  while (!(await third.evaluate((el) => el === document.activeElement))) await page.keyboard.press("ArrowDown");
  await page.keyboard.press(" ");
  await expect(grid.getByRole("checkbox", { name: `Select ${RUN} bulk three` })).toBeChecked();

  const bar = page.getByRole("region", { name: "Bulk edit" });
  await expect(bar).toContainText("3 selected");
  await bar.getByLabel("Set", { exact: true }).selectOption({ label: "Priority" });
  await bar.getByLabel("To", { exact: true }).selectOption({ label: "Critical" });
  await bar.getByRole("button", { name: "Apply to 3" }).click();
  await expect(bar.getByRole("status")).toContainText("3 updated.", { timeout: 15_000 });
  expect(priorities()).toBe("critical,critical,critical");
  await expect(grid.getByRole("row").filter({ hasText: `${RUN} bulk two` })).toContainText("Critical");

  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(bar.getByRole("status")).toContainText("Undone.", { timeout: 15_000 });
  expect(priorities()).toBe(before);
  await expect(grid.getByRole("row").filter({ hasText: `${RUN} bulk two` })).toContainText("Medium", { timeout: 15_000 });
});

test("a volunteer's bulk edit touches only rows they may edit [switches on]", async ({ page }) => {
  const priorityOf = (suffix: string) => sql(`select priority from public.task where title = '${RUN} vol ${suffix}'`);
  await signIn(page, "volunteer");
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name: "Tasks table" });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Search titles").fill(`${RUN} vol`);
  // They can read both: their own task, and one they only review.
  await expect.poll(() => titlesIn(page), { timeout: 30_000 }).toEqual([`${RUN} vol own`, `${RUN} vol review`]);

  // Every visible row: refused as a whole, nothing changes.
  await grid.getByRole("checkbox", { name: "Select all visible rows" }).check();
  const bar = page.getByRole("region", { name: "Bulk edit" });
  await bar.getByLabel("Set", { exact: true }).selectOption({ label: "Priority" });
  await bar.getByLabel("To", { exact: true }).selectOption({ label: "High" });
  await bar.getByRole("button", { name: "Apply to 2" }).click();
  await expect(bar.getByRole("status")).toContainText("not yours to change", { timeout: 15_000 });
  expect([priorityOf("own"), priorityOf("review")]).toEqual(["low", "low"]);

  // Only the row they may edit.
  await bar.getByRole("button", { name: "Clear selection" }).click();
  await grid.getByRole("checkbox", { name: `Select ${RUN} vol own` }).check();
  await bar.getByLabel("Set", { exact: true }).selectOption({ label: "Priority" });
  await bar.getByLabel("To", { exact: true }).selectOption({ label: "High" });
  await bar.getByRole("button", { name: "Apply to 1" }).click();
  await expect(bar.getByRole("status")).toContainText("1 updated.", { timeout: 15_000 });
  expect([priorityOf("own"), priorityOf("review")]).toEqual(["high", "low"]);
});
