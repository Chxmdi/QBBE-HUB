import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Wave 2 unit D1: a spreadsheet-style table, cells. Editing in place for each
 * kind the table shows, spreadsheet keys, copy and paste of ranges, every
 * change as a change set that can be undone, refused values, and read-only
 * records. Needs wos_lenses and wos_objects; the last test proves the table
 * is unchanged while wos_objects is off.
 */

const RUN = `D1Cells ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const READONLY = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
let previous = { lenses: "f", objects: "f" };
let fall = "";
let tutor = "";
let grantId = "";
const ids = { alpha: "", beta: "", gamma: "" };

const flag = (key: string) => sql(`select coalesce((select enabled from public.feature_flag where key = '${key}' and organization_id is null), false)`);
const setFlag = (key: string, on: boolean) => sql(`update public.feature_flag set enabled = ${on} where key = '${key}' and organization_id is null`);
/** What a paste or an undo said, on the line above the table. */
const said = (page: Page, text: string) => page.getByText(text, { exact: true }).first();

test.beforeAll(() => {
  previous = { lenses: flag("wos_lenses"), objects: flag("wos_objects") };
  setFlag("wos_lenses", true);
  fall = sql("select id from public.project where name = 'Fall Community Workshop Series'");
  tutor = sql("select id from public.project where name = 'Tutor Recruitment Drive'");
  // alpha and beta sit in the project qa-readonly may only read; gamma in one
  // they get contributor rights on for this file only.
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`
    insert into public.task (organization_id, title, created_by, project_id, status, priority, estimate_hours)
    select m.organization_id, '${RUN} ' || v.title, m.user_id, v.project::uuid, 'ready', v.priority::public.task_priority, v.estimate
    from public.organization_membership m
    cross join (values
      ('alpha', '${fall}', 'high', 2),
      ('beta', '${fall}', 'low', 3),
      ('gamma', '${tutor}', 'medium', null)
    ) as v(title, project, priority, estimate)
    where m.user_id = '${OWNER}';
  `);
  grantId = sql(`
    insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
    select organization_id, id, '${READONLY}', 'contributor', 'direct', '${OWNER}' from public.project where id = '${tutor}'
    returning id;
  `);
  for (const name of ["alpha", "beta", "gamma"] as const) ids[name] = sql(`select id from public.task where title = '${RUN} ${name}'`);
});

// Each test starts from the same three rows.
test.beforeEach(() => {
  sql(`delete from public.notification where source_id in ('${ids.alpha}', '${ids.beta}', '${ids.gamma}')`);
  sql(`
    update public.task t set title = '${RUN} ' || v.name, project_id = v.project::uuid, status = 'ready',
      priority = v.priority::public.task_priority, estimate_hours = v.estimate, due_at = null, requester_id = null, assignee_id = null
    from (values
      ('${ids.alpha}', 'alpha', '${fall}', 'high', 2),
      ('${ids.beta}', 'beta', '${fall}', 'low', 3),
      ('${ids.gamma}', 'gamma', '${tutor}', 'medium', null)
    ) as v(id, name, project, priority, estimate)
    where t.id = v.id::uuid;
  `);
});

test.afterAll(() => {
  sql(`delete from public.notification where source_id in (select id from public.task where title like '${RUN}%')`);
  sql(`delete from public.project_access_grant where id = '${grantId}'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  setFlag("wos_lenses", previous.lenses === "t");
  setFlag("wos_objects", previous.objects === "t");
});

async function openTable(page: Page, name = "Tasks table", search = "Search titles") {
  await page.goto("/lenses/table?type=task");
  const grid = page.getByRole("grid", { name });
  await expect(grid).toBeVisible({ timeout: 30_000 });
  await page.getByLabel(search).fill(RUN);
  // Header, three rows, totals.
  await expect(grid.getByRole("row")).toHaveCount(1 + 3 + 1, { timeout: 30_000 });
  await expect(grid.getByRole("row").nth(1)).toContainText(`${RUN} alpha`);
  return grid;
}

/** The cell of a data row (1 = first) under a column, found by its header. */
async function cell(grid: Locator, row: number, header: string | RegExp): Promise<Locator> {
  const names = await grid.getByRole("columnheader").allInnerTexts();
  const index = names.findIndex((n) => (typeof header === "string" ? n.split("\n")[0].trim() === header : header.test(n)));
  expect(index, `column ${header}`).toBeGreaterThanOrEqual(0);
  return grid.getByRole("row").nth(row).getByRole("gridcell").nth(index);
}

const status = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

async function axeProblems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
}

test("the owner edits every kind in place, moves like a spreadsheet and undoes changes [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  setFlag("wos_objects", true);
  await signIn(page, "owner");
  const grid = await openTable(page);
  const alpha = ids.alpha;

  // D1-2: keys. The header is the tab stop; arrows enter the rows.
  const title = await cell(grid, 1, "Title");
  await grid.getByRole("columnheader", { name: /Title/ }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(title).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(await cell(grid, 1, "Status")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(title).toBeFocused();
  await page.keyboard.press("End");
  await expect(await cell(grid, 1, "Edited")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(title).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(grid.getByRole("row").last().getByRole("gridcell").first()).toBeFocused();
  await page.keyboard.press("PageUp");
  await expect(grid.getByRole("columnheader").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  // F2 edits, Escape cancels and keeps the value.
  await page.keyboard.press("F2");
  await grid.getByRole("textbox", { name: "Edit Title" }).fill("not saved");
  await page.keyboard.press("Escape");
  await expect(title).toBeFocused();
  await expect(title).toHaveText(`${RUN} alpha`);

  // D1-1: text, Enter edits and Enter saves.
  await page.keyboard.press("Enter");
  await grid.getByRole("textbox", { name: "Edit Title" }).fill(`${RUN} alpha edited`);
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select title from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe(`${RUN} alpha edited`);
  await expect(page.getByRole("button", { name: "Undo last change" })).toBeVisible();

  // Number, with an English thousands separator.
  await (await cell(grid, 1, "Estimate (hours)")).focus();
  await page.keyboard.press("Enter");
  await grid.getByRole("textbox", { name: "Edit Estimate (hours)" }).fill("1,004.5");
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select estimate_hours::float8 from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe("1004.5");

  // Date.
  await (await cell(grid, 1, "Due")).focus();
  await page.keyboard.press("Enter");
  await grid.getByLabel("Edit Due").fill("2026-11-15");
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select due_at::date from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe("2026-11-15");

  // Select.
  await (await cell(grid, 1, "Priority")).focus();
  await page.keyboard.press("Enter");
  await grid.getByRole("combobox", { name: "Edit Priority" }).selectOption({ label: "Critical" });
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select priority from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe("critical");

  // Person, through the task's own command: the new assignee is notified,
  // exactly as when assigning from the task drawer.
  await (await cell(grid, 1, "Assignee")).focus();
  await page.keyboard.press("Enter");
  await grid.getByRole("combobox", { name: "Edit Assignee" }).selectOption({ label: "QA Staff" });
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select assignee_id from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe(STAFF);
  await expect
    .poll(() => sql(`select count(*) from public.notification where user_id = '${STAFF}' and source_id = '${alpha}' and category = 'assignment'`), { timeout: 15_000 })
    .toBe("1");

  await (await cell(grid, 1, "Requester")).focus();
  await page.keyboard.press("Enter");
  const requester = grid.getByRole("combobox", { name: "Edit Requester" });
  await expect(requester.getByRole("option", { name: "QA Staff" })).toHaveCount(1);
  await requester.selectOption({ label: "QA Staff" });
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select requester_id from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe(STAFF);

  // Relation: the project, from the projects the owner can see.
  const projectCell = await cell(grid, 1, "Project");
  await projectCell.focus();
  await page.keyboard.press("Enter");
  const project = grid.getByRole("combobox", { name: "Edit Project" });
  await expect(project.getByRole("option", { name: "Tutor Recruitment Drive" })).toHaveCount(1, { timeout: 15_000 });
  await project.selectOption({ label: "Tutor Recruitment Drive" });
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select project_id from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe(tutor);
  await expect(projectCell).toHaveText("Tutor Recruitment Drive");

  // D1-4: each change is one change set by the owner.
  expect(
    sql(`select string_agg(i.property, ',' order by s.created_at) from public.change_set s join public.change_set_item i on i.change_set_id = s.id
         where i.object_id = '${alpha}' and s.undo_of is null and s.actor_id = '${OWNER}' and s.action_key = 'object.set_property'`),
  ).toBe("title,estimate,due,priority,assignee,requester,project");

  // Undo from the button, then with Ctrl+Z on the grid: newest first.
  await page.getByRole("button", { name: "Undo last change" }).click();
  await expect.poll(() => sql(`select project_id from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe(fall);
  await expect(said(page, "Change undone.")).toBeVisible();
  await expect(projectCell).toHaveText("Fall Community Workshop Series", { timeout: 15_000 });
  await (await cell(grid, 1, "Requester")).focus();
  await page.keyboard.press("Control+z");
  await expect.poll(() => sql(`select coalesce(requester_id::text, 'none') from public.task where id = '${alpha}'`), { timeout: 15_000 }).toBe("none");
  expect(sql(`select count(*) from public.change_set where undo_of is not null and actor_id = '${OWNER}' and created_at > now() - interval '5 minutes'
              and id in (select change_set_id from public.change_set_item where object_id = '${alpha}')`)).toBe("2");

  // Accessibility with an editor open, in both themes.
  await (await cell(grid, 1, "Priority")).focus();
  await page.keyboard.press("Enter");
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      localStorage.setItem("qbbe-theme", value);
      document.documentElement.classList.toggle("dark", value === "dark");
    }, theme);
    await page.waitForTimeout(200);
    expect(await axeProblems(page), `${theme} theme`).toEqual([]);
  }
  await page.keyboard.press("Escape");
});

test("values that do not fit are refused with a message and nothing is saved [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  setFlag("wos_objects", true);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "owner");
  const grid = await openTable(page);
  const beta = ids.beta;

  // Text in a number: the editor stays open and says why.
  const estimate = await cell(grid, 2, "Estimate (hours)");
  await estimate.focus();
  await page.keyboard.press("Enter");
  const editor = grid.getByRole("textbox", { name: "Edit Estimate (hours)" });
  await editor.fill("lots");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a number, like 2.5." })).toBeVisible();
  await expect(editor).toHaveAttribute("aria-invalid", "true");
  await expect(editor).toBeFocused();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
    expect(await axeProblems(page), `${theme} theme with the message`).toEqual([]);
  }
  await page.keyboard.press("Escape");
  await expect(estimate).toBeFocused();
  expect(sql(`select estimate_hours::float8 from public.task where id = '${beta}'`)).toBe("3");

  // A date that does not exist, pasted.
  await (await cell(grid, 2, "Due")).focus();
  await page.evaluate(() => navigator.clipboard.writeText("2026-02-30"));
  await page.keyboard.press("Control+v");
  await expect(said(page, "Pasted 0 cells. Skipped 1 with values that do not fit.")).toBeVisible({ timeout: 15_000 });
  expect(sql(`select coalesce(due_at::text, 'none') from public.task where id = '${beta}'`)).toBe("none");

  // At phone width the message fits without scrolling the page sideways.
  await page.setViewportSize({ width: 320, height: 700 });
  await estimate.focus();
  await page.keyboard.press("Enter");
  await grid.getByRole("textbox", { name: "Edit Estimate (hours)" }).fill("12abc");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a number" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.keyboard.press("Escape");
  expect(sql(`select estimate_hours::float8 from public.task where id = '${beta}'`)).toBe("3");
});

test("in French, a range copies as tab-separated text and a paste fills only what the person can edit [switches on]", async ({ page }) => {
  test.setTimeout(150_000);
  setFlag("wos_objects", true);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "readonly");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  const grid = await openTable(page, "Tableau : Tâches", "Rechercher dans les titres");
  const { alpha, beta, gamma } = ids;

  // D1-6: alpha and beta are read-only for this person, gamma is not.
  const alphaTitle = await cell(grid, 1, "Titre");
  await expect(alphaTitle).toHaveAttribute("aria-readonly", "true", { timeout: 15_000 });
  await expect(await cell(grid, 3, "Titre")).not.toHaveAttribute("aria-readonly", "true");
  await alphaTitle.focus();
  await page.keyboard.press("Enter");
  await expect(grid.getByRole("textbox")).toHaveCount(0);
  await alphaTitle.dblclick();
  await expect(grid.getByRole("textbox")).toHaveCount(0);

  // D1-3: Shift+arrows select statuses and priorities of all three rows.
  await (await cell(grid, 1, "Statut")).focus();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(status(page, "Plage de 3 rangées sur 2 colonnes sélectionnée.")).toHaveCount(1);
  await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(6);
  await page.keyboard.press("Control+c");
  await expect(said(page, "6 cellules copiées.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Prête\tHaute\nPrête\tBasse\nPrête\tMoyenne");
  // Escape ends the selection.
  await page.keyboard.press("Escape");
  await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);

  // Paste a range over all three rows: only gamma's two cells change.
  await (await cell(grid, 1, "Statut")).focus();
  await page.evaluate(() => navigator.clipboard.writeText("En révision\tCritique\nEn révision\tCritique\nEn révision\tCritique\n"));
  await page.keyboard.press("Control+v");
  await expect(said(page, "2 cellules collées. 4 ignorées parce que vous ne pouvez pas les modifier.")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sql(`select status || ',' || priority from public.task where id = '${gamma}'`), { timeout: 15_000 }).toBe("in_review,critical");
  expect(sql(`select string_agg(status || ',' || priority, ';' order by title) from public.task where id in ('${alpha}', '${beta}')`)).toBe(
    "ready,high;ready,low",
  );
  await expect(await cell(grid, 3, "Statut")).toHaveText("En révision", { timeout: 15_000 });

  // D1-4: the paste is undone as one step.
  await page.getByRole("button", { name: "Annuler la dernière modification" }).click();
  await expect.poll(() => sql(`select status || ',' || priority from public.task where id = '${gamma}'`), { timeout: 15_000 }).toBe("ready,medium");
  await expect(said(page, "Modification annulée.")).toBeVisible();

  // D1-6: a forged edit. Tell the browser every row is editable; the server
  // still refuses alpha and nothing changes.
  await page.route("**/rest/v1/rpc/lens_editable", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { p_ids?: string[] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body.p_ids ?? []) });
  });
  await page.reload();
  const forged = await openTable(page, "Tableau : Tâches", "Rechercher dans les titres");
  const forgedTitle = await cell(forged, 1, "Titre");
  await expect(forgedTitle).not.toHaveAttribute("aria-readonly", "true", { timeout: 15_000 });
  await forgedTitle.focus();
  await page.keyboard.press("Enter");
  await forged.getByRole("textbox", { name: "Modifier Titre" }).fill(`${RUN} alpha forged`);
  await page.keyboard.press("Enter");
  await expect(status(page, "Vous pouvez consulter cette fiche, mais pas la modifier.")).toHaveCount(1, { timeout: 15_000 });
  await expect(forgedTitle).toHaveText(`${RUN} alpha`);
  expect(sql(`select title from public.task where id = '${alpha}'`)).toBe(`${RUN} alpha`);
  await page.context().clearCookies({ name: "qbbe-locale" });
});

test("with the object switch off the table edits only its earlier cells [switch off]", async ({ page }) => {
  setFlag("wos_objects", false);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, "owner");
  const grid = await openTable(page);
  const beta = ids.beta;

  await expect(await cell(grid, 2, "Estimate (hours)")).toHaveAttribute("aria-readonly", "true");
  await expect(await cell(grid, 2, "Title")).not.toHaveAttribute("aria-readonly", "true");
  await (await cell(grid, 2, "Estimate (hours)")).focus();
  await page.keyboard.press("Enter");
  await expect(grid.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo last change" })).toHaveCount(0);

  // Pasting does nothing, and Shift+arrow selects no range.
  await (await cell(grid, 2, "Priority")).focus();
  await page.evaluate(() => navigator.clipboard.writeText("Critical"));
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(grid.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(sql(`select priority from public.task where id = '${beta}'`)).toBe("low");

  // The title still saves through the earlier command.
  await (await cell(grid, 2, "Title")).focus();
  await page.keyboard.press("Enter");
  await grid.getByRole("textbox", { name: "Edit Title" }).fill(`${RUN} beta renamed`);
  await page.keyboard.press("Enter");
  await expect.poll(() => sql(`select title from public.task where id = '${beta}'`), { timeout: 15_000 }).toBe(`${RUN} beta renamed`);
});
