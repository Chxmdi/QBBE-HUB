import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M8d: saved views become lenses, and lenses are personal or
 * shared. Behind wos_lenses, turned on for this file only.
 */

const RUN = `LensSaved ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
let previous = "f";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.saved_view (organization_id, user_id, name, path, query, shared)
    select organization_id, '${STAFF}', '${RUN} staff high', '/board', '{"priority":"high"}', false
    from public.organization_membership where user_id = '${STAFF}';
    insert into public.saved_view (organization_id, user_id, name, path, query, shared)
    select organization_id, '${OWNER}', '${RUN} owner shared', '/my-work', '{"due":"week","label":"x"}', true
    from public.organization_membership where user_id = '${OWNER}';
    insert into public.saved_view (organization_id, user_id, name, path, query, shared)
    select organization_id, '${OWNER}', '${RUN} owner private', '/board', '{}', false
    from public.organization_membership where user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.saved_view where name like '${RUN}%'`);
  sql(`delete from public.lens where name like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("saved views appear as lenses, personal or shared, and reopen with their filters", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/lenses");
  const mine = page.getByRole("region", { name: "Your lenses" });
  const shared = page.getByRole("region", { name: "Shared with the organization" });
  await expect(mine.getByRole("link", { name: `${RUN} staff high` })).toBeVisible({ timeout: 30_000 });
  await expect(shared.getByRole("link", { name: `${RUN} owner shared` })).toBeVisible();
  await expect(shared).toContainText("Not converted: label");
  await expect(page.getByRole("link", { name: `${RUN} owner private` })).toHaveCount(0);
  // Converted saved views are managed from their old screen, so they offer
  // no share or delete here; nobody else's lens does either.
  await expect(shared.getByRole("button", { name: /Delete/ })).toHaveCount(0);

  // The board lists the staff member's saved board lens; it reopens with its filter.
  await page.goto("/lenses/board");
  const chips = page.getByRole("navigation", { name: "Saved lenses" });
  await chips.getByRole("link", { name: `${RUN} staff high` }).click();
  await expect(page).toHaveURL(/\/lenses\/board\?priority=high/);

  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("a table saved as a shared lens is visible to others, and making it personal hides it", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/lenses/table?type=task");
  await expect(page.getByRole("grid", { name: "Tasks table" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Group by").selectOption({ label: "Priority" });
  await page.getByRole("button", { name: "Save as lens" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as lens" });
  await dialog.getByLabel("Name").fill(`${RUN} by priority`);
  await dialog.getByRole("checkbox", { name: "Share with the organization" }).check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/lenses\/table\?lens=/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: `${RUN} by priority` })).toBeVisible();
  await expect(page.getByLabel("Group by")).toHaveValue("priority");
  expect(sql(`select visibility || ':' || (spec #>> '{groupBy,property}') from public.lens where name = '${RUN} by priority'`)).toBe("shared:priority");

  // Another person sees it shared, and cannot change it.
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto("/lenses");
  const shared = page.getByRole("region", { name: "Shared with the organization" });
  await expect(shared.getByRole("link", { name: `${RUN} by priority` })).toBeVisible({ timeout: 30_000 });
  await shared.getByRole("link", { name: `${RUN} by priority` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${RUN} by priority` })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

  // The owner makes it personal again; the staff member no longer sees it.
  await page.context().clearCookies();
  await signIn(page, "owner");
  await page.goto("/lenses");
  await page.getByRole("button", { name: `Make personal: ${RUN} by priority` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lens updated." })).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(() => sql(`select visibility from public.lens where name = '${RUN} by priority'`)).toBe("personal");
  await page.context().clearCookies();
  await signIn(page, "staff");
  await page.goto("/lenses");
  await expect(page.getByRole("link", { name: `${RUN} by priority` })).toHaveCount(0);
});

test("the lens list is accessible in French", async ({ page }) => {
  await signIn(page, "staff");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/lenses");
  await expect(page.getByRole("heading", { level: 1, name: "Vues" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Vos vues" })).toBeVisible();
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
