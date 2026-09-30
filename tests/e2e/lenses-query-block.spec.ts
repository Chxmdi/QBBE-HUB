import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M8e: the query block the editor embeds in pages, shown on its
 * preview route. Rows are always the reader's own.
 */

const RUN = `LensBlock ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
let previous = "f";
let lensId = "";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, status, priority, blocked_reason)
    select m.organization_id, '${RUN} ' || v.n, '${OWNER}', v.assignee::uuid, v.status::public.task_status, 'high',
      case when v.status = 'blocked' then 'Waiting' end
    from public.organization_membership m
    cross join (values ('one', '${OWNER}', 'ready'), ('two', '${OWNER}', 'blocked'), ('three', '${STAFF}', 'ready')) v(n, assignee, status)
    where m.user_id = '${OWNER}';
  `);
  lensId = sql(`
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} block', 'table', 'task',
      jsonb_build_object('version', 1, 'type', 'task', 'select', jsonb_build_array('status', 'priority'),
        'sort', jsonb_build_array(jsonb_build_object('property', 'title')),
        'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', '${RUN}')))),
      'shared'
    from public.organization_membership where user_id = '${OWNER}'
    returning id;
  `);
});

test.afterAll(() => {
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("a query block shows the reader's own rows, in each view", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/lenses/embed?lens=${lensId}`);
  const block = page.getByRole("region", { name: `${RUN} block` });
  await expect(block.getByRole("table")).toBeVisible({ timeout: 30_000 });
  await expect(block.getByRole("row")).toHaveCount(4);
  await expect(block.getByRole("link", { name: "Open in full" })).toHaveAttribute("href", `/lenses/table?lens=${lensId}`);

  await page.goto(`/lenses/embed?lens=${lensId}&view=list&rows=2`);
  await expect(block.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
  await expect(block).toContainText("1 more");

  await page.goto(`/lenses/embed?lens=${lensId}&view=board`);
  await expect(block.getByRole("heading", { level: 4 })).toHaveCount(2, { timeout: 30_000 });
  await expect(block).toContainText("Blocked");

  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);

  // Staff open the same shared lens and see only the task they can read.
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto(`/lenses/embed?lens=${lensId}`);
  await expect(block.getByRole("row")).toHaveCount(2, { timeout: 30_000 });
  await expect(block).toContainText(`${RUN} three`);
});

test("a block explains itself when it cannot show anything", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/lenses/embed?lens=11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("alert").filter({ hasText: "no longer exists, or is not shared with you" })).toBeVisible({ timeout: 30_000 });
  await page.goto(`/lenses/embed?lens=${lensId}&view=map`);
  await expect(page.getByRole("alert").filter({ hasText: "settings are not valid" })).toBeVisible({ timeout: 30_000 });
  // French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/lenses/embed?lens=11111111-1111-4111-8111-111111111111");
  await expect(page.getByRole("alert").filter({ hasText: "n’existe plus ou n’est pas partagée avec vous" })).toBeVisible({ timeout: 30_000 });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
