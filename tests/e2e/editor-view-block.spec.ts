import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * U6: the generic view block. A page's `query` block with version 2 props
 * shows any type or saved lens as a table, board, list, calendar or gallery,
 * runs as the reader through lens_query, and takes page-local filters that
 * live in this tab only, never in the page or the saved lens.
 */

const RUN = `ViewBlock ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const VOLUNTEER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const SWITCHES = "('wos_pages', 'wos_editor', 'wos_lenses')";
let previous = "";
let lensId = "";

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

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  previous = sql(`select coalesce(string_agg(key || '=' || enabled, ',' order by key), '') from public.feature_flag where key in ${SWITCHES} and organization_id is null`);
  sql(`update public.feature_flag set enabled = true where key in ${SWITCHES} and organization_id is null`);
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, blocked_reason)
    select m.organization_id, '${RUN} ' || v.n, '${OWNER}', v.assignee::uuid, v.status::public.task_status, v.priority::public.task_priority,
      case when v.status = 'blocked' then 'Waiting on a signature' end
    from public.organization_membership m
    cross join (values
      ('one', '${OWNER}', 'ready', 'high'),
      ('two', '${OWNER}', 'blocked', 'low'),
      ('three', '${STAFF}', 'ready', 'high'),
      ('four', '${VOLUNTEER}', 'in_progress', 'medium')
    ) v(n, assignee, status, priority)
    where m.user_id = '${OWNER}';
  `);
  lensId = sql(`
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} lens', 'table', 'task',
      jsonb_build_object('version', 1, 'type', 'task', 'select', jsonb_build_array('status', 'priority'),
        'sort', jsonb_build_array(jsonb_build_object('property', 'title')),
        'where', jsonb_build_object('and', jsonb_build_array(
          jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', '${RUN}'),
          jsonb_build_object('property', 'assignee', 'operator', 'not_contains', 'value', '${VOLUNTEER}')))),
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

const lensState = () => sql(`select md5(spec::text) || ':' || updated_at::text from public.lens where id = '${lensId}'`);
const storedBlock = (pageId: string) =>
  sql(`select b->'props'->>'spec' from public.editor_document, jsonb_array_elements(content->'blocks') b where object_id = '${pageId}' and b->>'type' = 'query'`);

async function viewBlock(page: Page, title: string) {
  const block = page.locator("[data-view-block]").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(block).toBeVisible({ timeout: 30_000 });
  return block;
}

test("a view block shows tasks as a board and filters locally without changing the saved lens [switches on]", async ({ page }) => {
  test.setTimeout(180_000);
  const pageId = pageWithView(OWNER, `${RUN} board page`, "workspace", {
    version: 2,
    source: { lensId },
    layout: "table",
    pageFilters: { enabled: true, paths: ["assignee", "priority"] },
  });
  const before = lensState();

  await signIn(page, "owner");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} lens`);
  await expect(block.getByRole("table").getByRole("row")).toHaveCount(4, { timeout: 30_000 });

  // Configure it as a board from the settings panel, by keyboard-reachable controls.
  await block.getByRole("button", { name: "Configure view" }).click();
  const settings = block.getByRole("dialog", { name: "View settings" });
  await expect(settings.getByLabel("Layout")).toBeVisible({ timeout: 30_000 });
  await settings.getByLabel("Layout").selectOption("board");
  await settings.getByRole("button", { name: "Apply" }).click();
  await expect(settings).toHaveCount(0);
  await expect(block.getByRole("button", { name: "Configure view" })).toBeFocused();

  const board = block.getByRole("region", { name: `${RUN} lens` });
  await expect(board.getByRole("region", { name: "Ready" })).toBeVisible({ timeout: 30_000 });
  await expect(board.getByRole("region", { name: "Blocked" })).toBeVisible();
  await expect(block.locator("[data-view-card]")).toHaveCount(3);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  expect(JSON.parse(storedBlock(pageId))).toMatchObject({ version: 2, layout: "board", source: { lensId } });
  const savedBlock = storedBlock(pageId);

  // Page-local filters: only this reader, only this tab.
  await block.getByRole("checkbox", { name: "Assignee: me" }).check();
  await expect(block.locator("[data-view-card]")).toHaveCount(2, { timeout: 30_000 });
  await expect(block).not.toContainText(`${RUN} three`);
  await block.getByLabel("Priority").selectOption("high");
  await expect(block.locator("[data-view-card]")).toHaveCount(1, { timeout: 30_000 });
  await expect(block).toContainText(`${RUN} one`);

  const results = await new AxeBuilder({ page }).include("[data-view-block]").analyze();
  expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);

  // Nothing shared changed: not the saved lens, not the page's block.
  await page.waitForTimeout(1500);
  expect(lensState()).toBe(before);
  expect(storedBlock(pageId)).toBe(savedBlock);

  // The filters stay for this tab after a reload, and clear on request.
  await page.reload();
  const again = await viewBlock(page, `${RUN} lens`);
  await expect(again.getByRole("checkbox", { name: "Assignee: me" })).toBeChecked();
  await expect(again.locator("[data-view-card]")).toHaveCount(1, { timeout: 30_000 });
  await again.getByRole("button", { name: "Clear filters" }).click();
  await expect(again.locator("[data-view-card]")).toHaveCount(3, { timeout: 30_000 });

  // Another reader of the same page starts with no filters, and sees only what they can read.
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto(`/pages/${pageId}`);
  const staffView = await viewBlock(page, `${RUN} lens`);
  await expect(staffView.getByRole("checkbox", { name: "Assignee: me" })).not.toBeChecked();
  await expect(staffView).toContainText(`${RUN} three`, { timeout: 30_000 });
  await expect(staffView).not.toContainText(`${RUN} one`);
});

test("a volunteer sees only their own rows in a view block [switches on]", async ({ page }) => {
  test.setTimeout(120_000);
  const pageId = pageWithView(VOLUNTEER, `${RUN} volunteer page`, "private", {
    version: 2,
    source: { type: "task" },
    layout: "list",
    title: `${RUN} everyone's tasks`,
    where: [{ path: "title", op: "starts_with", value: RUN }],
    fields: ["status", "assignee"],
  });
  // All four tasks exist; the block asks for all of them.
  expect(sql(`select count(*) from public.task where title like '${RUN} %'`)).toBe("4");

  await signIn(page, "volunteer");
  await page.goto(`/pages/${pageId}`);
  const block = await viewBlock(page, `${RUN} everyone's tasks`);
  await expect(block.locator("[data-view-row]")).toHaveCount(1, { timeout: 30_000 });
  await expect(block).toContainText(`${RUN} four`);
  for (const other of ["one", "two", "three"]) await expect(block).not.toContainText(`${RUN} ${other}`);

  // Narrowed to nothing, it says so rather than showing a blank block.
  sql(`update public.task set assignee_id = '${STAFF}' where title = '${RUN} four'`);
  await page.reload();
  const empty = await viewBlock(page, `${RUN} everyone's tasks`);
  await expect(empty.getByText("No rows you can see.")).toBeVisible({ timeout: 30_000 });
  sql(`update public.task set assignee_id = '${VOLUNTEER}' where title = '${RUN} four'`);

  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: new URL(page.url()).origin }]);
  await page.reload();
  const fr = await viewBlock(page, `${RUN} everyone's tasks`);
  await expect(fr.getByRole("link", { name: "Ouvrir en entier" })).toBeVisible({ timeout: 30_000 });
  await page.context().clearCookies({ name: "qbbe-locale" });
});
