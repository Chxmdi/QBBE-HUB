import { expect, test, type Page } from "@playwright/test";
import { signIn, signOut } from "./auth";

/**
 * Acceptance evidence for #30 (P0-TSK-06/07/08) and the parts of #29 that can
 * only be shown through the browser: that a change persists, that a filter
 * narrows the real result set, that the board and the list are the same
 * records, and that a shared link re-checks access.
 *
 * Runs against the migrated synthetic local database, like the rest of the
 * authenticated suite.
 */

async function createTask(
  page: Page,
  fields: { title: string; priority?: string; due?: string; criteria?: string },
) {
  await page.goto("/my-work?create=task");
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(fields.title);
  await dialog
    .getByLabel("Assignee", { exact: true })
    .selectOption({ label: "QA Owner" });
  if (fields.priority) {
    await dialog.getByLabel("Priority", { exact: true }).selectOption(fields.priority);
  }
  if (fields.due) {
    await dialog.getByLabel("Due date", { exact: true }).fill(fields.due);
  }
  if (fields.criteria) {
    await dialog.getByLabel(/Completion criteria/).fill(fields.criteria);
  }
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  // The address must stop saying "open the create dialog" before anything
  // reloads, or the reload reopens an empty form over the saved task.
  await expect(page).not.toHaveURL(/create=task/, { timeout: 30_000 });
}

test("a created task carries its full detail and keeps it across a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Acceptance detail ${Date.now()}`;
  await createTask(page, {
    title,
    priority: "high",
    criteria: "Signed off by the program lead",
  });

  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // Re-read from the server rather than trusting the optimistic list, which is
  // the difference between "the interface said so" and "the record says so".
  await page.reload();
  // Creating a task must not leave `create=task` in the address; otherwise this
  // reload reopens an empty form on top of the work that was just saved.
  await expect(page.getByRole("dialog", { name: "Create task" })).toHaveCount(0);
  await page.getByText(title, { exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByLabel("Completion criteria")).toHaveValue(
    "Signed off by the program lead",
    { timeout: 30_000 },
  );
});

test("filters narrow the real result set and survive being shared", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  const critical = `Filter critical ${stamp}`;
  const low = `Filter low ${stamp}`;
  await createTask(page, { title: critical, priority: "critical" });
  await createTask(page, { title: low, priority: "low" });

  await page.goto("/my-work");
  await expect(page.getByText(critical, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(low, { exact: true })).toBeVisible();

  await page.getByLabel("Filter by priority").selectOption("critical");
  await expect(page).toHaveURL(/priority=critical/, { timeout: 30_000 });
  await expect(page.getByText(critical, { exact: true })).toBeVisible();
  await expect(page.getByText(low, { exact: true })).toHaveCount(0);

  // The filter lives in the URL, so the same address reproduces the same view.
  await page.goto("/my-work?priority=critical");
  await expect(page.getByText(critical, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(low, { exact: true })).toHaveCount(0);

  // An unparseable filter costs that filter, not the page.
  await page.goto("/my-work?priority=not-a-priority");
  await expect(page.getByText(critical, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(low, { exact: true })).toBeVisible();

  await page.goto("/my-work?priority=critical");
  await page.getByRole("button", { name: /Clear 1 filter/ }).click();
  await expect(page.getByText(low, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("the board and the list show one set of records, movable by keyboard", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Parity ${Date.now()}`;
  await createTask(page, { title });

  await page.goto("/board");
  const card = page.getByRole("article").filter({ hasText: title });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("region", { name: "Not started column" })
      .or(page.locator("section[aria-label='Not started column']"))
      .filter({ hasText: title }),
  ).toBeVisible();

  // Keyboard alone: focus the card's status control and choose a new column.
  const status = card.getByLabel("Task status");
  await status.focus();
  await expect(status).toBeFocused();
  await status.selectOption("in_progress");

  // The move is announced rather than only drawn, for anyone not watching it.
  await expect(page.getByRole("status")).toContainText("moved to In progress", {
    timeout: 30_000,
  });

  // It is the record that moved, not the card: the list agrees after a reload.
  await page.reload();
  await expect(
    page.locator("section[aria-label='In progress column']").filter({ hasText: title }),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto("/my-work?status=in_progress");
  await expect(page.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
});

test("a task records who changed what", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `History ${Date.now()}`;
  await createTask(page, { title, priority: "low" });

  await page.goto("/my-work");
  await page.getByText(title, { exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByLabel("Priority", { exact: true }).selectOption("critical");

  // The address carries the task, so the reload re-opens the drawer from the
  // server without another click.
  await page.reload();
  const history = page
    .getByRole("dialog")
    .getByRole("region", { name: "History", exact: true });
  await expect(history.getByText(/changed Priority from Low to Critical/)).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(history.getByText("QA Owner").first()).toBeVisible();
});

test("a task link re-checks access for whoever opens it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Private ${Date.now()}`;
  await createTask(page, { title });
  await page.goto("/my-work");
  await page.getByText(title, { exact: true }).click();
  await expect(page).toHaveURL(/task=[0-9a-f-]{36}/, { timeout: 30_000 });
  const shared = page.url();

  await signOut(page);
  await signIn(page, "volunteer");
  await page.goto(shared);

  await expect(page.getByText("This task isn't available to you")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});
