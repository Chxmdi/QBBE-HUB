import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/** Workspace OS V1-5: the dashboard lens, behind wos_lenses. */

const RUN = `LensDash ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
let previous = "f";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, estimate_hours)
    select organization_id, '${RUN} ' || v.n, '${OWNER}', v.a::uuid, v.s::public.task_status, v.p::public.task_priority, v.e
    from public.organization_membership,
      (values ('one', '${OWNER}', 'ready', 'high', 2), ('two', '${OWNER}', 'completed', 'high', 3), ('three', null, 'ready', 'low', 5)) as v(n, a, s, p, e)
    where user_id = '${OWNER}';
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} source', 'table', 'task',
      jsonb_build_object('version', 1, 'type', 'task',
        'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', '${RUN}')))),
      'shared'
    from public.organization_membership where user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

async function addTile(page: import("@playwright/test").Page, fields: { kind: string; title: string; source?: string; measure?: string; groupBy?: string; target?: string; body?: string }) {
  await page.getByRole("button", { name: "Add a tile" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a tile" });
  await dialog.getByLabel("Tile").selectOption({ label: fields.kind });
  await dialog.getByLabel("Title").fill(fields.title);
  if (fields.body) await dialog.getByLabel("Text").fill(fields.body);
  if (fields.source) await dialog.getByLabel("Records").selectOption({ label: fields.source });
  if (fields.measure) await dialog.getByLabel("Measure").selectOption({ label: fields.measure });
  if (fields.groupBy) await dialog.getByLabel("Group by").selectOption({ label: fields.groupBy });
  if (fields.target) await dialog.getByLabel("Target").fill(fields.target);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Dashboard saved." })).toHaveCount(1, { timeout: 15_000 });
}

test("an owner builds a shared dashboard; filters narrow every tile; others see their own figures", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  await page.goto("/lenses/dashboard");
  await page.getByLabel("Name").fill(`${RUN} board`);
  await page.getByRole("checkbox", { name: "Share with the organization" }).check();
  await page.getByRole("button", { name: "New dashboard" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${RUN} board` })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Edit tiles" }).click();
  const source = `${RUN} source`;
  await addTile(page, { kind: "Figure", title: "How many", source });
  await addTile(page, { kind: "Figure", title: "Hours", source, measure: "Sum of Estimate (hours)" });
  await addTile(page, { kind: "Chart", title: "By priority", source, groupBy: "Priority" });
  await addTile(page, { kind: "Progress", title: "Done", source });
  await addTile(page, { kind: "Goal", title: "Goal", source, target: "6" });
  await addTile(page, { kind: "Text", title: "Note", body: "Weekly check-in." });
  await addTile(page, { kind: "Table", title: "The list", source });

  const tile = (name: string) => page.locator("li[data-tile]").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(tile("How many").locator("[data-metric]")).toHaveText("3", { timeout: 30_000 });
  await expect(tile("Hours").locator("[data-metric]")).toHaveText("10");
  await expect(tile("By priority").getByRole("row", { name: /High/ })).toContainText("2");
  await expect(tile("Done")).toContainText("1 of 3 done");
  await expect(tile("Goal")).toContainText("3 of 6");
  await expect(tile("Note")).toContainText("Weekly check-in.");
  await expect(page.getByRole("region", { name: "The list" }).getByRole("row")).toHaveCount(4, { timeout: 30_000 });

  // Reorder and remove are saved.
  await page.getByRole("button", { name: "Move Hours up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Dashboard saved." })).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole("button", { name: "Remove Note" }).click();
  await expect(page.locator("li[data-tile]").filter({ hasText: "Weekly check-in." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Done" })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  const headings = await page.locator("li[data-tile] h2").allInnerTexts();
  expect(headings.slice(0, 2)).toEqual(["Hours", "How many"]);
  expect(headings).not.toContain("Note");

  // Dashboard-wide filter: only mine.
  await page.getByRole("checkbox", { name: "Only mine" }).check();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/mine=1/);
  await expect(tile("How many").locator("[data-metric]")).toHaveText("2", { timeout: 30_000 });

  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);

  // Staff open the shared dashboard: their own figures, and no editing.
  const url = page.url().replace(/&.*$/, "");
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: `${RUN} board` })).toBeVisible({ timeout: 30_000 });
  await expect(tile("How many").locator("[data-metric]")).toHaveText("0", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Edit tiles" })).toHaveCount(0);
});

test("the dashboard list is accessible in French", async ({ page }) => {
  await signIn(page, "staff");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/lenses/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Tableaux de bord" })).toBeVisible({ timeout: 30_000 });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
