import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * The MVP exit test (epic #199, docs/plans/workspace-os-execution.md, "Gate
 * MVP"): a task written in meeting notes appears in My tasks, on the board, on
 * the calendar and on the project page, and one edit updates all of them.
 *
 * Runs with every Workspace OS switch on: the app must be built and started
 * with `WORKSPACE_OS_FLAGS=all`. The override turns switches on only, so the
 * `feature_flag` rows other specs flip do not matter here, and this spec
 * flips none itself. `wos_meetings_v2` is not in the shared override list
 * (src/features/meetings-v2/flag.ts reads the same variable on its own), so
 * `all` covers it too.
 *
 * Two doors into the same object layer, both from the keyboard:
 *
 * 1. The meeting (S5 V1-9, integration I5): the organizer writes the notes on
 *    /meetings-v2 in the block editor; a `/task` block there asks for the
 *    title, project, owner and due date and creates the task at once, in the
 *    meeting's project, with the meeting as its source (M7) and a meeting
 *    action beside it. The capture form and the end-of-meeting review still
 *    make a task from a capture, and the review lists the notes' tasks too.
 *    After the one edit the meeting shows the new date everywhere it prints
 *    one: the task block, the review, the classic actions list.
 * 2. The block editor (M4–M6): a sentence naming a person and a date on a
 *    page gets the "Make a task" suggestion, which creates the task with that
 *    assignee and due date, and the task block *is* the task, with the page
 *    as the task's source.
 *
 * Live updates: none of the lenses, Home, the living project page or the
 * meeting page subscribe to Realtime (no channel in src/features/lenses,
 * home, project-page or meetings-v2), so the app promises fresh data on
 * navigation, not in place. Every re-check below therefore navigates again
 * (`page.goto`), which is a reload for the screen under test.
 *
 * Dates: the lens engine and Home resolve "today" in America/Toronto and
 * `task.due_at` is a `date` column, so every fixture day is computed by the
 * database in that zone. The due days sit 20 and 27 days out, so the
 * board's short label is always a calendar day (never "Today", "Tomorrow"
 * or a weekday name) and the result is the same at any hour of any day.
 */

const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const STAFF_NAME = "QA Staff";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const ORIGIN = "http://127.0.0.1:3000";

/** A calendar day in Quebec, `days` from today, as YYYY-MM-DD. */
function quebecDay(days: number): string {
  return sql(`select to_char((now() at time zone 'America/Toronto')::date + ${days}, 'YYYY-MM-DD')`);
}

/** The app's formats for a `date` value: the board's "Oct. 21" and Home's "Oct. 21, 2026". */
function asNoon(day: string) {
  return new Date(`${day}T12:00:00Z`);
}
const shortDay = (day: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", month: "short", day: "numeric" }).format(asNoon(day));
const longDay = (day: string, locale: "en-CA" | "fr-CA" = "en-CA") =>
  new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(asNoon(day));

type Fixture = { org: string; projectId: string; projectName: string; meetingId: string; meetingTitle: string };

/** A program, a project the staff member manages, and a meeting in that project. */
function fixture(stamp: string): Fixture {
  const org = sql(`select organization_id from public.organization_membership where user_id = '${STAFF}'`);
  const projectName = `Gala ${stamp}`;
  const meetingTitle = `Gala planning ${stamp}`;
  const row = sql(`
    with prog as (
      insert into public.program (organization_id, name, slug, created_by)
      values ('${org}', '${projectName}', 'gala-${stamp.toLowerCase()}', '${STAFF}') returning id
    ), proj as (
      insert into public.project (organization_id, program_id, name, owner_id, created_by)
      select '${org}', prog.id, '${projectName}', '${STAFF}', '${STAFF}' from prog returning id, program_id
    ), grant_row as (
      insert into public.project_access_grant (organization_id, project_id, user_id, role, source, created_by)
      select '${org}', proj.id, '${STAFF}', 'project_manager', 'direct', '${STAFF}' from proj
    ), m as (
      insert into public.meeting (organization_id, program_id, project_id, title, organizer_id, starts_at)
      select '${org}', proj.program_id, proj.id, '${meetingTitle}', '${STAFF}', now() from proj returning id
    )
    select proj.id || '|' || m.id from proj, m;`);
  const [projectId, meetingId] = row.split("|");
  return { org, projectId, projectName, meetingId, meetingTitle };
}

async function noSeriousAxe(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  await page.mouse.move(0, 0);
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const problems = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} ${v.nodes[0]?.html?.slice(0, 160)}`);
  expect(problems, label).toEqual([]);
}

async function setTheme(page: Page, theme: "light" | "dark") {
  // The app reads this key before paint (src/app/layout.tsx), so the next
  // navigation renders in the chosen theme from the first frame.
  await page.evaluate((t) => localStorage.setItem("qbbe-theme", t), theme);
}

/* ---------- the four places, plus Home, with the content each one shows ---------- */

/** /lenses/my-work: the assignee's list on the lens engine (M8c). */
async function expectInMyWork(page: Page, title: string, day: string) {
  await page.goto(`/lenses/my-work?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible({ timeout: 30_000 });
  const row = page.locator('[data-lens-section="later"] [data-lens-row]').filter({ hasText: title });
  await expect(row.getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText(shortDay(day));
}

/** /home/world: My tasks, with the due date as a fact (M17b). */
async function expectInMyWorld(page: Page, title: string, day: string) {
  await page.goto("/home/world");
  const mine = page.getByRole("region", { name: /^My tasks/ });
  await expect(mine.getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(mine.getByRole("listitem").filter({ hasText: title })).toContainText(`Due ${longDay(day)}`);
}

/** /lenses/board: the card and its due label. */
async function expectOnBoard(page: Page, title: string, day: string) {
  await page.goto(`/lenses/board?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Board" })).toBeVisible({ timeout: 30_000 });
  const card = page.locator("[data-lens-card]").filter({ hasText: title });
  await expect(card.getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(shortDay(day));
}

/** /lenses/calendar: the chip sits in the cell of its due day, and nowhere else. */
async function expectOnCalendar(page: Page, title: string, day: string, notOn?: string) {
  await page.goto(`/lenses/calendar?at=${day}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`td[data-day="${day}"]`).getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  if (notOn) await expect(page.locator(`td[data-day="${notOn}"]`).getByRole("link", { name: title })).toHaveCount(0);
}

/** /home/projects/:id: the living project page's Open tasks block (M19). */
async function expectOnProjectPage(page: Page, projectId: string, projectName: string, title: string, day: string) {
  await page.goto(`/home/projects/${projectId}`);
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible({ timeout: 30_000 });
  const open = page.getByRole("region", { name: "Open tasks" });
  await expect(open.getByRole("link", { name: title })).toBeVisible({ timeout: 30_000 });
  await expect(open.getByRole("listitem").filter({ hasText: title })).toContainText(`Due ${longDay(day)}`);
}

/** The one edit: the due date, from the task's own screen (the drawer). */
async function moveDueDate(page: Page, taskId: string, title: string, day: string) {
  await page.goto(`/my-work?task=${taskId}`);
  const drawer = page.getByRole("dialog").filter({ hasText: title });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  const due = drawer.getByLabel("Due date", { exact: true });
  await due.focus();
  await due.fill(day);
  await expect(page.getByRole("status").filter({ hasText: "Task updated." })).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => sql(`select due_at::text from public.task where id = '${taskId}'`), { timeout: 15_000 }).toBe(day);
}

async function everywhere(page: Page, f: Fixture, title: string, day: string, notOn?: string) {
  await expectInMyWork(page, title, day);
  await expectInMyWorld(page, title, day);
  await expectOnBoard(page, title, day);
  await expectOnCalendar(page, title, day, notOn);
  await expectOnProjectPage(page, f.projectId, f.projectName, title, day);
}

/* ---------- the test ---------- */

test.describe.configure({ mode: "serial" });

let f: Fixture;
let stamp = "";
let dueDay = "";
let movedDay = "";
let meetingTask = "";
let meetingTaskId = "";
let captureTask = "";
let pageTask = "";
let pageTaskId = "";
let pageId = "";

test.beforeAll(() => {
  stamp = Date.now().toString(36).toUpperCase();
  f = fixture(stamp);
  dueDay = quebecDay(20);
  movedDay = quebecDay(27);
  meetingTask = `Book the hall ${stamp}`;
  captureTask = `Confirm the caterer ${stamp}`;
  pageTask = `${STAFF_NAME} to order chairs ${stamp} tomorrow`;
});

// The month grid shows four chips per day and folds the rest into "+N more",
// so the tasks are removed afterwards: a second run on the same database
// (a developer's rerun, `--repeat-each`) would otherwise fill the cell and
// hide its own chip. The program, project and meeting stay, as other specs'
// fixtures do.
test.afterAll(() => {
  if (stamp) sql(`delete from public.task where title like '%${stamp}%'`);
});

test("a task written in the meeting's notes shows in My tasks, the board, the calendar and the project page, and one edit moves all of them, the meeting included [switches on]", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "staff");
  await page.goto(`/meetings-v2/${f.meetingId}`);
  await expect(page.getByRole("heading", { level: 1, name: f.meetingTitle })).toBeVisible({ timeout: 30_000 });

  // The notes are the block editor (F1), typed from the keyboard. A `/task`
  // block asks for the title, the project (the meeting's own comes first),
  // the owner and the due date (F2), and creates the task there and then.
  const notes = page.getByRole("textbox", { name: "Meeting notes" });
  await expect(notes).toBeVisible({ timeout: 30_000 });
  await notes.click();
  await page.keyboard.type("Discussed the venue.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/task");
  // Scoped to the slash menu: the capture form's "Type" select has a "Task" option too.
  await expect(page.getByRole("listbox", { name: "Blocks" }).getByRole("option", { name: /^Task\b/, selected: true })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.getByLabel("Search tasks").fill(meetingTask);
  await expect(page.getByLabel("Project for the new task")).toHaveValue(f.projectId);
  await page.getByLabel("Owner", { exact: true }).selectOption({ label: STAFF_NAME });
  await page.getByLabel("Due date", { exact: true }).fill(dueDay);
  await page.getByRole("button", { name: `Create task “${meetingTask}”` }).click();

  // The block is the task, and prints its owner and due date (F4).
  const block = page.locator('[data-content-type="task"]').filter({ hasText: meetingTask });
  await expect(block.getByRole("checkbox", { name: `Mark “${meetingTask}” done` })).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText(STAFF_NAME);
  await expect(block).toContainText(`Due ${longDay(dueDay)}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });

  // One task row, in the meeting's project, assigned and dated as typed, with
  // the meeting as its source (M7) and a meeting action beside it; the notes
  // are saved as a document whose block row names the task, and the plain
  // text copy the classic page reads follows.
  meetingTaskId = sql(`select id from public.task where title = '${meetingTask}'`);
  expect(meetingTaskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(
    sql(`select project_id || '|' || assignee_id || '|' || due_at::text || '|' || source_type || ':' || source_id
         from public.task where id = '${meetingTaskId}'`),
  ).toBe(`${f.projectId}|${STAFF}|${dueDay}|meeting:${f.meetingId}`);
  expect(
    sql(`select count(*) from public.meeting_action
         where meeting_id = '${f.meetingId}' and task_id = '${meetingTaskId}' and owner_id = '${STAFF}' and due_at::text = '${dueDay}'`),
  ).toBe("1");
  await expect
    .poll(() => sql(`select count(*) from public.block where object_id = '${f.meetingId}' and referenced_object_id = '${meetingTaskId}'`))
    .toBe("1");
  expect(sql(`select notes from public.meeting where id = '${f.meetingId}'`)).toContain("Discussed the venue.");

  // The capture form, typed: a second task with an owner and a due date, for
  // the end-of-meeting review to approve.
  const captureForm = page.getByRole("form", { name: "Capture" });
  await captureForm.getByLabel("Type", { exact: true }).selectOption("task");
  const said = captureForm.getByLabel("What was said");
  await said.focus();
  await page.keyboard.type(captureTask);
  await captureForm.getByLabel("Owner (optional)").selectOption({ label: STAFF_NAME });
  await captureForm.getByLabel("Due (optional)").fill(dueDay);
  await said.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Captured." })).toBeVisible({ timeout: 30_000 });
  const captured = page.getByRole("listitem").filter({ hasText: captureTask });
  await expect(captured).toContainText("Waiting for review");
  await expect(captured).toContainText(STAFF_NAME);
  await expect(captured).toContainText(longDay(dueDay));

  // The review lists the task made in the notes, as it is now, and turns the
  // capture into a second task.
  await page.getByRole("link", { name: /End-of-meeting review/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "End-of-meeting review" })).toBeVisible({ timeout: 30_000 });
  const fromNotes = page.getByRole("region", { name: "Created from the notes" });
  await expect(fromNotes.getByRole("link", { name: meetingTask })).toBeVisible();
  const fromNotesRow = fromNotes.getByRole("listitem").filter({ hasText: meetingTask });
  await expect(fromNotesRow).toContainText("Not started");
  await expect(fromNotesRow).toContainText(STAFF_NAME);
  await expect(fromNotesRow).toContainText(`Due ${longDay(dueDay)}`);
  await expect(page.getByRole("group", { name: `Outcome for “${captureTask}”` })).toBeVisible();
  await page.getByRole("button", { name: "Apply review" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Review applied: 1 created, 0 kept, 0 dismissed." })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("link", { name: "Task created" })).toHaveCount(1);
  expect(
    sql(`select project_id || '|' || assignee_id || '|' || due_at::text || '|' || source_type || ':' || source_id
         from public.task where title = '${captureTask}'`),
  ).toBe(`${f.projectId}|${STAFF}|${dueDay}|meeting:${f.meetingId}`);

  // The four places (and Home), each showing the title and the due date.
  await everywhere(page, f, meetingTask, dueDay);
  // The review's task is on the project page too.
  await expect(page.getByRole("region", { name: "Open tasks" }).getByRole("link", { name: captureTask })).toBeVisible();

  // One edit, from the task's own screen.
  await moveDueDate(page, meetingTaskId, meetingTask, movedDay);

  // Every place shows the new day; the calendar's old cell is empty. Each is
  // reached by navigation (see the header: nothing here updates in place).
  await everywhere(page, f, meetingTask, movedDay, dueDay);

  // The meeting too (F3, F4): the task block reads the task when the notes
  // load again, the review's list reads it the same way, and the classic
  // page's actions list holds the date the database keeps in step.
  await page.goto(`/meetings-v2/${f.meetingId}`);
  const reloaded = page.locator('[data-content-type="task"]').filter({ hasText: meetingTask });
  await expect(reloaded).toContainText(`Due ${longDay(movedDay)}`, { timeout: 30_000 });
  await expect(reloaded).not.toContainText(longDay(dueDay));
  const approved = page.getByRole("listitem").filter({ hasText: captureTask });
  await expect(approved).toContainText("Approved");
  await expect(approved).toContainText("Not started");
  await expect(approved).toContainText(STAFF_NAME);
  await page.goto(`/meetings-v2/${f.meetingId}/review`);
  await expect(fromNotes.getByRole("listitem").filter({ hasText: meetingTask })).toContainText(`Due ${longDay(movedDay)}`, { timeout: 30_000 });
  await page.goto(`/meetings/${f.meetingId}`);
  const action = page.getByRole("listitem").filter({ hasText: meetingTask });
  await expect(action).toBeVisible({ timeout: 30_000 });
  await expect(action).toContainText(longDay(movedDay));
  expect(sql(`select due_at::text from public.meeting_action where task_id = '${meetingTaskId}'`)).toBe(movedDay);
});

test("a task made from a sentence in the block editor lands in the same places, and the block is the task [switches on]", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "staff");

  // A page of notes for the meeting, written from the keyboard.
  await page.goto("/pages");
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "New page", exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  pageId = page.url().split("/").pop()!;
  const titleBox = page.getByRole("textbox", { name: "Page title" });
  await titleBox.fill(`Notes: ${f.meetingTitle}`);
  await titleBox.press("Enter");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.type("## Decisions and actions");
  await page.keyboard.press("Enter");
  await page.keyboard.type(pageTask);

  // The sentence names a person and a date: the quiet suggestion appears (M6).
  const icon = page.getByRole("button", { name: `Make a task: ${pageTask}` });
  await expect(icon).toBeVisible({ timeout: 15_000 });
  await icon.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Make a task" });
  await expect(dialog).toContainText(`Assigned to ${STAFF_NAME}`);
  await expect(dialog.getByLabel("Due date")).toHaveValue(quebecDay(1));
  await dialog.getByLabel("Due date").fill(dueDay);
  await dialog.getByLabel("Project for the new task").selectOption({ label: f.projectName });
  await dialog.getByRole("button", { name: "Create the task" }).click();

  // The block is the task: its checkbox names the task, and the row exists.
  const done = page.getByRole("checkbox", { name: `Mark “${pageTask}” done` });
  await expect(done).toBeVisible({ timeout: 30_000 });
  pageTaskId = sql(`select id from public.task where title = '${pageTask}'`);
  expect(pageTaskId).toMatch(/^[0-9a-f-]{36}$/);
  // Assigned and dated as the dialog said, with the page as its source (F5).
  expect(
    sql(`select project_id || '|' || assignee_id || '|' || due_at::text || '|' || source_type || ':' || source_id
         from public.task where id = '${pageTaskId}'`),
  ).toBe(`${f.projectId}|${STAFF}|${dueDay}|page:${pageId}`);
  const pageBlock = page.locator('[data-content-type="task"]').filter({ hasText: pageTask });
  await expect(pageBlock).toContainText(STAFF_NAME);
  await expect(pageBlock).toContainText(`Due ${longDay(dueDay)}`);
  await expect(page.getByTestId("editor-save-state")).toHaveText("Saved", { timeout: 30_000 });
  await expect
    .poll(() => sql(`select count(*) from public.block where object_id = '${pageId}' and referenced_object_id = '${pageTaskId}'`))
    .toBe("1");

  await everywhere(page, f, pageTask, dueDay);
  await moveDueDate(page, pageTaskId, pageTask, movedDay);
  await everywhere(page, f, pageTask, movedDay, dueDay);

  // Back on the page, the block shows the task as it is now: the moved date
  // (F4). Ticking it done there is the task's own status.
  await page.goto(`/pages/${pageId}`);
  const block = page.getByRole("checkbox", { name: `Mark “${pageTask}” done` });
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-content-type="task"]').filter({ hasText: pageTask })).toContainText(`Due ${longDay(movedDay)}`);
  await expect(block).not.toBeChecked();
  await block.focus();
  await page.keyboard.press("Space");
  await expect.poll(() => sql(`select status from public.task where id = '${pageTaskId}'`), { timeout: 15_000 }).toBe("completed");
});

test("every screen on the path passes axe in light and dark, and the main path reads in French [switches on]", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "staff");
  const q = encodeURIComponent(meetingTask);
  const screens: { name: string; path: string; content: (page: Page) => Locator }[] = [
    { name: "meeting", path: `/meetings-v2/${f.meetingId}`, content: (p) => p.getByRole("heading", { level: 1, name: f.meetingTitle }) },
    { name: "review", path: `/meetings-v2/${f.meetingId}/review`, content: (p) => p.getByRole("region", { name: "Created from the notes" }).getByRole("link", { name: meetingTask }) },
    { name: "page", path: `/pages/${pageId}`, content: (p) => p.getByRole("checkbox", { name: `Mark “${pageTask}” done` }) },
    { name: "my-work", path: `/lenses/my-work?q=${q}`, content: (p) => p.getByRole("link", { name: meetingTask }) },
    { name: "my-world", path: "/home/world", content: (p) => p.getByRole("region", { name: /^My tasks/ }).getByRole("link", { name: meetingTask }) },
    { name: "board", path: `/lenses/board?q=${q}`, content: (p) => p.locator("[data-lens-card]").getByRole("link", { name: meetingTask }) },
    { name: "calendar", path: `/lenses/calendar?at=${movedDay}`, content: (p) => p.locator(`td[data-day="${movedDay}"]`).getByRole("link", { name: meetingTask }) },
    { name: "project", path: `/home/projects/${f.projectId}`, content: (p) => p.getByRole("region", { name: "Open tasks" }).getByRole("link", { name: meetingTask }) },
    { name: "task", path: `/my-work?task=${meetingTaskId}`, content: (p) => p.getByRole("dialog").getByLabel("Due date", { exact: true }) },
  ];
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    for (const screen of screens) {
      await page.goto(screen.path);
      await expect(screen.content(page), `${screen.name} ${theme}`).toBeVisible({ timeout: 30_000 });
      expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(theme === "dark");
      await noSeriousAxe(page, `${screen.name} ${theme}`);
    }
  }
  await setTheme(page, "light");

  // French: the same records under French labels, with the date in French.
  await page.context().addCookies([{ name: "qbbe-locale", value: "fr-CA", url: ORIGIN }]);
  const frDay = longDay(movedDay, "fr-CA");
  await page.goto(`/meetings-v2/${f.meetingId}`);
  await expect(page.getByRole("heading", { level: 1, name: f.meetingTitle })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Noté pendant la réunion" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: captureTask })).toContainText("Approuvé");
  // The task block in the notes, in French with the Quebec date.
  await expect(page.locator('[data-content-type="task"]').filter({ hasText: meetingTask })).toContainText(`Échéance : ${frDay}`, {
    timeout: 30_000,
  });
  await noSeriousAxe(page, "meeting fr");

  await page.goto(`/lenses/my-work?q=${q}`);
  await expect(page.getByRole("heading", { level: 1, name: "Mon travail" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-lens-row]").filter({ hasText: meetingTask }).getByRole("link", { name: meetingTask })).toBeVisible();
  await noSeriousAxe(page, "my-work fr");

  await page.goto(`/lenses/board?q=${q}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tableau kanban" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-lens-card]").getByRole("link", { name: meetingTask })).toBeVisible();
  await noSeriousAxe(page, "board fr");

  await page.goto(`/lenses/calendar?at=${movedDay}`);
  await expect(page.getByRole("heading", { level: 1, name: "Calendrier" })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`td[data-day="${movedDay}"]`).getByRole("link", { name: meetingTask })).toBeVisible();
  await noSeriousAxe(page, "calendar fr");

  await page.goto(`/home/projects/${f.projectId}`);
  const open = page.getByRole("region", { name: "Tâches ouvertes" });
  await expect(open.getByRole("link", { name: meetingTask })).toBeVisible({ timeout: 30_000 });
  await expect(open.getByRole("listitem").filter({ hasText: meetingTask })).toContainText(`Échéance : ${frDay}`);
  await noSeriousAxe(page, "project fr");

  await page.goto("/home/world");
  const mine = page.getByRole("region", { name: /^Mes tâches/ });
  await expect(mine.getByRole("link", { name: meetingTask })).toBeVisible({ timeout: 30_000 });
  await expect(mine.getByRole("listitem").filter({ hasText: meetingTask })).toContainText(`Échéance : ${frDay}`);
  await noSeriousAxe(page, "my-world fr");
  await page.context().clearCookies({ name: "qbbe-locale" });
});
