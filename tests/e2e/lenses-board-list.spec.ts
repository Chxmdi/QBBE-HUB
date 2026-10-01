import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";
import { signIn, type QaAccount } from "./auth";
import { sql } from "./db";

/**
 * Workspace OS M8c: the board and My Work on the lens engine, behind
 * wos_lenses, beside the unchanged /board and /my-work.
 *
 * The comparison test signs in as every QA account and checks that the old
 * screen and the new one show exactly the same tasks, from a fixture spread
 * across people, roles, projects and statuses.
 */

const RUN = `LensCmp ${Date.now().toString(36)}`;
const ACCOUNTS: QaAccount[] = ["owner", "admin", "staff", "volunteer", "guest", "lead", "pm", "contributor", "readonly"];
let previous = "f";

const U = {
  owner: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
  staff: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
  volunteer: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3",
  lead: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6",
  pm: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7",
  contributor: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8",
};

test.beforeAll(() => {
  previous = sql("select coalesce((select enabled from public.feature_flag where key = 'wos_lenses'), false)");
  sql("update public.feature_flag set enabled = true where key = 'wos_lenses'");
  // Tasks inside every seeded project (so scoped grants decide visibility),
  // plus tasks with no project, across assignees, reviewers, approvers, task
  // roles and statuses (completed ones are outside the default view).
  sql(`
    with org as (select organization_id as id from public.organization_membership where user_id = '${U.owner}'),
    projects as (select id, program_id, row_number() over (order by name) as n from public.project where archived_at is null),
    people(n, person) as (values (1, '${U.owner}'::uuid), (2, '${U.staff}'::uuid), (3, '${U.volunteer}'::uuid),
      (4, '${U.lead}'::uuid), (5, '${U.pm}'::uuid), (6, '${U.contributor}'::uuid), (7, null::uuid))
    insert into public.task (organization_id, project_id, program_id, title, created_by, assignee_id, reviewer_id, approver_id, status, blocked_reason, priority, due_at)
    select org.id, p.id, p.program_id,
      '${RUN} ' || coalesce(p.n::text, 'none') || '-' || pe.n || '-' || s.status,
      '${U.owner}', pe.person,
      case when pe.n = 2 then '${U.volunteer}'::uuid end,
      case when pe.n = 3 then '${U.staff}'::uuid end,
      s.status::public.task_status,
      case when s.status = 'blocked' then 'Waiting on a signature' end,
      'medium', current_date + pe.n
    from org
    cross join (select id, program_id, n from projects union all select null, null, null) p
    cross join people pe
    cross join (values ('ready'), ('blocked'), ('completed')) s(status);
    insert into public.task_assignment (task_id, user_id, role)
    select id, '${U.contributor}', 'reviewer' from public.task where title like '${RUN} %-1-ready';
  `);
});

test.afterAll(() => {
  sql(`delete from public.task where title like '${RUN} %'`);
  sql(`update public.feature_flag set enabled = ${previous === "t" ? "true" : "false"} where key = 'wos_lenses'`);
});

const sorted = (titles: (string | null | undefined)[]) =>
  titles.filter((t): t is string => Boolean(t && t.startsWith(RUN))).map((t) => t.trim()).sort();

async function oldBoardTitles(page: Page) {
  await page.goto(`/board?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  // Expand every column so nothing is hidden behind "Show more".
  // Each click removes its own button, so always take the first one left.
  const more = page.getByRole("button", { name: /^Show \d+ more$/ });
  while ((await more.count()) > 0) await more.first().click();
  return sorted(await page.locator("main article").evaluateAll((els) => els.map((e) => e.querySelector("button")?.textContent)));
}

async function newBoardTitles(page: Page) {
  await page.goto(`/lenses/board?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible({ timeout: 30_000 });
  // Each click removes its own button, so always take the first one left.
  const more = page.getByRole("button", { name: /^Show \d+ more$/ });
  while ((await more.count()) > 0) await more.first().click();
  return sorted(await page.locator("[data-lens-card] a").allInnerTexts());
}

async function oldMyWork(page: Page) {
  await page.goto(`/my-work?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  // The old list folds rows past TASK_LIST_ROW_LIMIT per bucket behind "Show
  // more", as the old board does per column; the fixture holds two tasks per
  // project for a person, so a workspace with more than twelve projects
  // (every spec that leaves one behind adds to the seed) crosses it. Expand
  // every bucket, as the board helpers do, so the comparison reads everything.
  const more = page.getByRole("button", { name: /^Show \d+ more$/ });
  while ((await more.count()) > 0) await more.first().click();
  const labels = (loc: ReturnType<Page["locator"]>) =>
    loc.evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").replace(/^Select /, "")));
  const review = sorted(await labels(page.locator('section[aria-labelledby="review-queue"] input[type="checkbox"]')));
  const all = sorted(await labels(page.locator('main input[type="checkbox"]')));
  const owned = all.filter((title) => !review.includes(title));
  return { review, owned };
}

async function newMyWork(page: Page) {
  await page.goto(`/lenses/my-work?q=${encodeURIComponent(RUN)}`);
  await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible({ timeout: 30_000 });
  const review = sorted(await page.locator('[data-lens-section="review"] [data-lens-row] a').allInnerTexts());
  const owned = sorted(
    await page
      .locator('[data-lens-section="overdue"], [data-lens-section="today"], [data-lens-section="this_week"], [data-lens-section="later"]')
      .locator("[data-lens-row] a")
      .allInnerTexts(),
  );
  return { review, owned };
}

test("the new board and My Work show the same tasks as the old ones, for every role", async ({ page }) => {
  test.setTimeout(600_000);
  const report: string[] = [];
  for (const account of ACCOUNTS) {
    await page.context().clearCookies();
    await signIn(page, account);
    const [oldBoard, newBoard] = [await oldBoardTitles(page), await newBoardTitles(page)];
    expect(newBoard, `${account}: board`).toEqual(oldBoard);
    const [oldWork, newWork] = [await oldMyWork(page), await newMyWork(page)];
    expect(newWork.review, `${account}: review queue`).toEqual(oldWork.review);
    expect(newWork.owned, `${account}: owned work`).toEqual(oldWork.owned);
    report.push(`${account}: board ${newBoard.length}, review ${newWork.review.length}, owned ${newWork.owned.length}`);
  }
  test.info().annotations.push({ type: "records per role", description: report.join("; ") });
  // The fixture must actually exercise the comparison.
  expect(report.some((line) => !line.includes("board 0"))).toBe(true);
});

test("a card moves by keyboard on the new board, and the pages pass axe in English and French", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto(`/lenses/board?q=${encodeURIComponent(`${RUN} none-1-ready`)}`);
  const card = page.locator("[data-lens-card]").filter({ hasText: `${RUN} none-1-ready` });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const select = card.getByRole("combobox");
  await select.focus();
  await select.selectOption({ label: "In progress" });
  await expect(page.getByRole("status").filter({ hasText: "moved to In progress" })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => sql(`select status from public.task where title = '${RUN} none-1-ready'`), { timeout: 15_000 })
    .toBe("in_progress");

  for (const path of ["/lenses/board", "/lenses/my-work"]) {
    for (const locale of ["en", "fr-CA"] as const) {
      if (locale === "fr-CA") await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: "http://127.0.0.1:3000" }]);
      else await page.context().clearCookies({ name: "qbbe-locale" });
      await page.goto(`${path}?q=${encodeURIComponent(RUN)}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        locale === "fr-CA" ? (path.endsWith("board") ? "Tableau kanban" : "Mon travail") : path.endsWith("board") ? "Board" : "My work",
        { timeout: 30_000 },
      );
      const result = await new AxeBuilder({ page }).analyze();
      const violations = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(violations, `${path} ${locale}: ${JSON.stringify(violations)}`).toEqual([]);
    }
  }
  await page.context().clearCookies({ name: "qbbe-locale" });
});
