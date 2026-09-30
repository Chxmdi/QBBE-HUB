import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/** Workspace OS V1-1: the calendar lens, behind wos_lenses. */

const RUN = `LensCal ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
let previous = "f";
let dueDay = "";
let moveDay = "";

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  // Two days inside the current month, in the workspace's zone.
  dueDay = sql("select to_char(date_trunc('month', now() at time zone 'America/Toronto')::date + 9, 'YYYY-MM-DD')");
  moveDay = sql("select to_char(date_trunc('month', now() at time zone 'America/Toronto')::date + 11, 'YYYY-MM-DD')");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, due_at, start_at)
    select organization_id, '${RUN} planning', '${OWNER}', '${OWNER}', '${dueDay}', '${dueDay}'::date - 2
    from public.organization_membership where user_id = '${OWNER}';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("tasks sit on their day, move from the calendar, and every view is accessible", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/lenses/calendar?at=${dueDay}`);
  const cell = page.locator(`td[data-day="${dueDay}"]`);
  await expect(cell.getByRole("link", { name: `${RUN} planning` })).toBeVisible({ timeout: 30_000 });

  // Keyboard-reachable date field on the chip moves the due date.
  const field = cell.getByLabel(new RegExp(`${RUN} planning`));
  await field.fill(moveDay);
  await expect.poll(() => sql(`select due_at::text from public.task where title = '${RUN} planning'`), { timeout: 15_000 }).toBe(moveDay);
  await page.goto(`/lenses/calendar?at=${dueDay}`);
  await expect(page.locator(`td[data-day="${moveDay}"]`).getByRole("link", { name: `${RUN} planning` })).toBeVisible({ timeout: 30_000 });

  // Dates from the start date instead.
  await page.getByRole("navigation", { name: "Dates from" }).getByRole("link", { name: "Start" }).click();
  const startDay = sql(`select to_char(start_at, 'YYYY-MM-DD') from public.task where title = '${RUN} planning'`);
  await expect(page.locator(`td[data-day="${startDay}"]`).getByRole("link", { name: `${RUN} planning` })).toBeVisible({ timeout: 30_000 });

  for (const view of ["Month", "Week", "Next 30 days"]) {
    await page.getByRole("group", { name: "View" }).getByRole("link", { name: view }).click();
    await expect(page.getByRole("link", { name: view })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious"), view).toEqual([]);
  }
});

test("a volunteer sees none of the owner's tasks, in French", async ({ page }) => {
  await signIn(page, "volunteer");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto(`/lenses/calendar?at=${dueDay}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendrier" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: `${RUN} planning` })).toHaveCount(0);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
