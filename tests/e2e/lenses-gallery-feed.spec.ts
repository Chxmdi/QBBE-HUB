import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/** Workspace OS V1-3 and V1-4: the gallery and feed lenses, behind wos_lenses. */

const RUN = `LensGf ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
let previous = "f";
let lensId = "";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, priority, due_at, updated_at)
    select organization_id, '${RUN} ' || v.n, '${OWNER}', '${OWNER}', v.p::public.task_priority, current_date + 3, now() - (v.age || ' hours')::interval
    from public.organization_membership, (values ('older', 'low', 30), ('newer', 'high', 1)) as v(n, p, age)
    where user_id = '${OWNER}';
  `);
  lensId = sql(`
    insert into public.lens (organization_id, owner_id, name, kind, type_key, spec, visibility)
    select organization_id, '${OWNER}', '${RUN} cards', 'gallery', 'task',
      jsonb_build_object('version', 1, 'type', 'task', 'select', jsonb_build_array('priority', 'due'),
        'where', jsonb_build_object('and', jsonb_build_array(jsonb_build_object('property', 'title', 'operator', 'starts_with', 'value', '${RUN}')))),
      'shared'
    from public.organization_membership where user_id = '${OWNER}' returning id;
  `);
});

test.afterAll(() => {
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("the gallery shows a lens as cards with its facts", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/lenses/gallery?lens=${lensId}`);
  const cards = page.getByRole("list", { name: "Tasks cards" });
  await expect(cards.getByRole("listitem")).toHaveCount(2, { timeout: 30_000 });
  const newer = cards.getByRole("listitem").filter({ hasText: `${RUN} newer` });
  await expect(newer).toContainText("Priority");
  await expect(newer).toContainText("High");
  await expect(newer.getByRole("link", { name: `${RUN} newer` })).toHaveAttribute("href", /\/my-work\?task=/);
  await page.goto("/lenses/gallery?type=project");
  await expect(page.getByRole("list", { name: "Projects cards" })).toBeVisible({ timeout: 30_000 });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("the feed shows the most recent change first, and follows edits", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/lenses/feed?lens=${lensId}`);
  const items = page.locator("[data-feed-item]");
  await expect(items).toHaveCount(2, { timeout: 30_000 });
  await expect(items.first()).toContainText(`${RUN} newer`);
  await expect(items.first()).toContainText("Updated");
  sql(`update public.task set priority = 'critical' where title = '${RUN} older'`);
  await page.reload();
  await expect(items.first()).toContainText(`${RUN} older`, { timeout: 30_000 });
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("a volunteer sees none of the owner's cards or changes, in French", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  for (const [path, heading] of [[`/lenses/gallery?lens=${lensId}`, "Galerie"], [`/lenses/feed?lens=${lensId}`, "Fil"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({ timeout: 30_000 });
    // The shared lens's name shows; none of the owner's tasks do.
    await expect(page.getByText(`${RUN} newer`)).toHaveCount(0);
    await expect(page.getByText(`${RUN} older`)).toHaveCount(0);
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  }
  await page.context().clearCookies({ name: "qbbe-locale" });
});
