import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #31 (P1-TSK-10, P1-TSK-12).
 *
 * Two of the four rows in the issue are settled here, because two of them are
 * only settled in a browser: whether an arrangement somebody made is the
 * arrangement that comes back, and whether moving a record on the calendar
 * moves the record rather than the picture of it.
 *
 * P1-TSK-09 milestone dependencies are covered at both levels: the cycle
 * guard and the policy denials are in `supabase/tests/work-planning.sql`,
 * where the guarantees actually live, and the reachable surface is the last
 * test below.
 *
 * P1-TSK-11 recurring series is enforced in the database suite only. A series
 * now carries through `updateTaskStatus`, so completing an occurrence creates
 * the next one and a stopped series creates nothing — but there is no surface
 * for creating or stopping one yet, and there is deliberately no browser test
 * here pretending otherwise.
 */

async function createTask(page: Page, title: string, due?: string) {
  await page.goto("/my-work?create=task");
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: "QA Owner" });
  if (due) await dialog.getByLabel("Due date", { exact: true }).fill(due);
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/create=task/, { timeout: 30_000 });
  await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function openTask(page: Page, title: string) {
  await page.getByText(title, { exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  return drawer;
}

test("a checklist keeps the order somebody arranged, counts itself, and lets items go", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Checklist acceptance ${Date.now()}`;
  await createTask(page, title);
  let drawer = await openTask(page, title);

  // The drawer has a second "Add" button for dependencies, so the checklist
  // form is addressed through its own field rather than by button name.
  const checklistForm = drawer.locator("form").filter({
    has: page.getByPlaceholder("Add a checklist item"),
  });
  for (const item of ["Book the room", "Send the agenda", "Confirm catering"]) {
    await checklistForm.getByPlaceholder("Add a checklist item").fill(item);
    await checklistForm.getByRole("button", { name: "Add", exact: true }).click();
    await expect(drawer.getByText(item, { exact: true })).toBeVisible({ timeout: 30_000 });
  }

  // The roll-up P1-TSK-10 asks for. Nothing is ticked yet, so this is the
  // claim that the count is real rather than a placeholder.
  await expect(drawer.getByText("0 of 3 done")).toBeVisible({ timeout: 30_000 });

  await drawer.getByRole("checkbox").first().check();
  await expect(drawer.getByText("1 of 3 done")).toBeVisible({ timeout: 30_000 });

  // Move the last item to the top using the keyboard alone. Dragging is the
  // usual way to reorder and cannot be done this way, which is why the buttons
  // are the only path offered.
  const ordered = async () =>
    (
      await page.getByRole("list", { name: "Checklist" }).getByRole("listitem").allInnerTexts()
    ).map((t) => t.split("\n")[0].trim());

  // One press, one assertion. Each move is a round trip that re-reads the
  // list, so firing both presses together would recompute the second from an
  // order the server had not answered with yet.
  await expect
    .poll(async () => (await ordered())[2], { timeout: 30_000 })
    .toContain("Confirm catering");
  await drawer.getByRole("button", { name: "Move Confirm catering up" }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ordered())[1], { timeout: 30_000 })
    .toContain("Confirm catering");
  await drawer.getByRole("button", { name: "Move Confirm catering up" }).focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await ordered())[0], { timeout: 30_000 })
    .toContain("Confirm catering");

  // The arrangement has to survive leaving the page, or it was only ever a
  // property of this render.
  // The drawer opens from `?task=<id>`, so a reload reopens it on its own.
  // Clicking the row again would only find the open dialog in the way.
  await page.reload();
  drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await ordered())[0], { timeout: 30_000 })
    .toContain("Confirm catering");

  await drawer.getByRole("button", { name: "Remove Send the agenda" }).click();
  await expect(drawer.getByText("Send the agenda", { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(drawer.getByText(/of 2 done/)).toBeVisible({ timeout: 30_000 });
});

test("rescheduling a task on the calendar moves the record, not just the chip", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  // A date inside the current week, so the chip is on screen without paging.
  const today = new Date();
  const due = today.toISOString().slice(0, 10);
  const title = `Calendar acceptance ${Date.now()}`;
  await createTask(page, title, due);

  await page.goto("/calendar");
  const field = page.getByLabel(`Reschedule ${title}`);
  await expect(field).toBeVisible({ timeout: 30_000 });
  await expect(field).toHaveValue(due);

  const moved = new Date(today.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  await field.fill(moved);
  await field.blur();

  // The record, read straight from the database rather than from the page that
  // just claimed to have changed it. This is the difference P1-TSK-12 turns
  // on: a calendar that redraws itself proves nothing about what was stored.
  await expect
    .poll(
      () =>
        sql(
          `select due_at::text from task where title = '${title.replace(/'/g, "''")}' limit 1;`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe(moved);

  // And the date is the day that was picked, not a day either side of it. A
  // reschedule that round-trips through an instant lands here when the
  // workspace zone is behind UTC.
  await page.reload();
  await expect(page.getByLabel(`Reschedule ${title}`)).toHaveValue(moved, {
    timeout: 30_000,
  });
});

test("a read-only member is not offered a reschedule they would be refused", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "volunteer");
  await page.goto("/calendar");

  // The control is offered on what a viewer may move, so a volunteer with no
  // project manager grant should see none of them. This is the paired half of
  // the database denial in work-planning.sql: RLS refuses the write, and the
  // product does not invite it in the first place.
  // The calendar's heading is the date range it is showing, so the stable
  // anchor is the page description rather than a title that changes weekly.
  await expect(
    page.getByText(/on one calendar\./),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^Reschedule /)).toHaveCount(0);
});

test("a milestone can be blocked by another, and a cycle is never offered", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog", { name: "Create project" });
  await dialog.getByLabel("Name", { exact: true }).fill(`Dependency project ${stamp}`);
  await dialog.getByRole("button", { name: "Create project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/, { timeout: 60_000 });

  let created = 0;
  for (const name of ["Book the venue", "Send invitations"]) {
    await page.getByRole("button", { name: "Add milestone" }).click();
    const add = page.getByRole("dialog", { name: "Add milestone" });
    await add.getByLabel("Name", { exact: true }).fill(name);
    await add.getByRole("button", { name: "Create", exact: true }).click();
    await expect(add).not.toBeVisible({ timeout: 30_000 });
    // Count rows rather than match the name: once blockers exist, every row's
    // select lists every other milestone, so the name appears in rows that are
    // not it.
    created += 1;
    await expect(
      page.getByRole("region", { name: "Milestones", exact: true }).getByRole("listitem"),
    ).toHaveCount(created, { timeout: 30_000 });
  }

  // Invitations wait on the venue.
  await page
    .getByLabel("Add a blocker for Send invitations")
    .selectOption({ label: "Book the venue" });
  await expect(page.getByText("Blocked by:")).toBeVisible({ timeout: 30_000 });

  // The reverse edge would now be a cycle, so it is not offered at all. This
  // is the client half; work-planning.sql proves the database refuses the
  // longer loops a viewer cannot see well enough to avoid.
  await expect(
    page.getByLabel("Add a blocker for Book the venue"),
  ).toHaveCount(0);

  // It has to survive a reload, or it was a rendered edge and not a stored one.
  await page.reload();
  await expect(page.getByText("Blocked by:")).toBeVisible({ timeout: 30_000 });
});
