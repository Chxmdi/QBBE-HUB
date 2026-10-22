import { expect, test } from "./fixtures";
import { signIn, signOut } from "./auth";
import { sql } from "./db";

/**
 * The assignee hears about their work. The owner assigns tasks to qa-staff
 * through the app, both ways it happens (a new task created for them, and an
 * existing task handed to them from its drawer); nothing is written with SQL,
 * so each notice comes from the command that made the change. qa-staff finds
 * them in their inbox and opens the task from it. Runs as production runs,
 * with the switches either way.
 */
test("a task assigned to someone reaches their inbox and opens the task", async ({ page }) => {
  test.setTimeout(180_000);
  const title = `Assigned notice ${Date.now()}`;
  const handed = `Handed over ${Date.now()}`;
  const staffId = sql(`select id::text from user_profile where email = 'qa-staff@example.com'`);

  await signIn(page, "owner");
  await page.goto("/my-work?create=task");
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: "QA Staff" });
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });

  // The command wrote one assignment notice for qa-staff, for this task.
  const taskId = sql(`select id::text from task where title = '${title}'`);
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(
      () =>
        sql(`select count(*) from notification
             where user_id = '${staffId}' and category = 'assignment' and source_id = '${taskId}'`),
      { timeout: 30_000 },
    )
    .toBe("1");

  // An existing task of the owner's, handed to qa-staff from its drawer.
  await page.goto("/my-work?create=task");
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(handed);
  await dialog.getByLabel("Assignee", { exact: true }).selectOption({ label: "QA Owner" });
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  const handedId = sql(`select id::text from task where title = '${handed}'`);
  await page.goto(`/my-work?task=${handedId}`);
  const drawer = page.getByRole("dialog", { name: handed });
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await drawer.getByLabel("Assignee", { exact: true }).selectOption({ label: "QA Staff" });
  await expect
    .poll(
      () =>
        sql(`select count(*) from notification
             where user_id = '${staffId}' and category = 'assignment' and source_id = '${handedId}'`),
      { timeout: 30_000 },
    )
    .toBe("1");
  await signOut(page);

  await signIn(page, "staff");
  await page.goto("/inbox");
  const item = page.getByRole("region", { name: "Notifications" }).getByRole("listitem").filter({ hasText: title });
  await expect(item).toBeVisible({ timeout: 30_000 });
  const notice = item.getByRole("link", { name: "QA Owner assigned you a task" });
  await expect(notice).toHaveAttribute("href", `/my-work?task=${taskId}`);
  await expect(
    page.getByRole("region", { name: "Notifications" }).getByRole("listitem").filter({ hasText: handed }),
  ).toBeVisible();
  await notice.click();
  await expect(page).toHaveURL(new RegExp(`task=${taskId}`), { timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: title })).toBeVisible({ timeout: 30_000 });
});
