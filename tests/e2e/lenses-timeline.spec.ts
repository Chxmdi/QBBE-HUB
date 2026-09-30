import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/** Workspace OS V1-2: the timeline lens, behind wos_lenses. */

const RUN = `LensTl ${Date.now().toString(36)}`;
const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
let previous = "f";

const dates = (title: string) => sql(`select start_at::text || ' ' || due_at::text from public.task where title = '${RUN} ${title}'`);

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  sql(`
    insert into public.task (organization_id, title, created_by, assignee_id, start_at, due_at)
    select organization_id, '${RUN} ' || v.name, '${OWNER}', '${OWNER}', current_date + v.s, current_date + v.e
    from public.organization_membership, (values ('design', 2, 4), ('build', 5, 6), ('launch', 20, 21)) as v(name, s, e)
    where user_id = '${OWNER}';
    insert into public.task_dependency (blocking_task_id, blocked_task_id)
    select a.id, b.id from public.task a, public.task b
    where a.title = '${RUN} design' and b.title = '${RUN} build';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN}%'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

test("bars move by keyboard, dependents move after confirming, and a drag reschedules", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/lenses/timeline");
  const design = page.getByRole("button", { name: new RegExp(`^${RUN} design,`) });
  await expect(design).toBeVisible({ timeout: 30_000 });
  const designId = await design.getAttribute("data-bar");
  await expect(page.locator(`path[data-edge^="${designId}->"]`)).toHaveCount(1);
  await expect(page.getByRole("button", { name: new RegExp(`^${RUN} build,`) })).toBeVisible();

  const before = { design: dates("design"), build: dates("build") };
  const shift = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const [ds, de] = before.design.split(" ");
  const [bs, be] = before.build.split(" ");

  // Three days later by keyboard: "build" would start too early, so ask.
  await design.focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Move the tasks that wait on it?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${RUN} build`);
  await dialog.getByRole("button", { name: "Move all 2" }).click();
  await expect.poll(() => dates("design"), { timeout: 15_000 }).toBe(`${shift(ds, 3)} ${shift(de, 3)}`);
  // build started the day after design was due; it now starts the day after the new due date, same length.
  expect(dates("build")).toBe(`${shift(bs, 3)} ${shift(be, 3)}`);

  // Drag "launch" two days later: nothing waits on it, so it saves at once.
  await page.reload();
  const launch = page.getByRole("button", { name: new RegExp(`^${RUN} launch,`) });
  await expect(launch).toBeVisible({ timeout: 30_000 });
  const [ls, le] = dates("launch").split(" ");
  const box = (await launch.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10 + 28, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + 10 + 56, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => dates("launch"), { timeout: 15_000 }).toBe(`${shift(ls, 2)} ${shift(le, 2)}`);

  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
});

test("Escape cancels a keyboard move; a volunteer sees none of the owner's tasks, in French", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/lenses/timeline");
  const launch = page.getByRole("button", { name: new RegExp(`^${RUN} launch,`) });
  await expect(launch).toBeVisible({ timeout: 30_000 });
  const before = dates("launch");
  await launch.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  expect(dates("launch")).toBe(before);

  await page.context().clearCookies();
  await signIn(page, "volunteer");
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
  await page.goto("/lenses/timeline");
  await expect(page.getByRole("heading", { level: 1, name: "Chronologie" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: new RegExp(RUN) })).toHaveCount(0);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  await page.context().clearCookies({ name: "qbbe-locale" });
});
