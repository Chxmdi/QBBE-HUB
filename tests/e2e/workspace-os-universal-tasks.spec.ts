import { randomUUID } from "node:crypto";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { clickWhenInteractive } from "./interactive";
import { sql } from "./db";

/**
 * Universal tasks (M7, epic #199): the task form and a meeting action both go
 * through the one create-task action, and each task records where it came from.
 */

test("tasks record their source whichever door they come through", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const typed = `Typed task ${suffix}`;
  const action = `Send the minutes ${suffix}`;

  await signIn(page, "owner");

  // The task form: a manual task, with the source on its activity entry.
  await page.goto("/my-work?create=task");
  const form = page.getByRole("dialog", { name: "Create task" });
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByLabel("Title", { exact: true }).fill(typed);
  await form.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(form).not.toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => sql(`select source_type || ':' || coalesce(source_id::text, '-') from task where title = '${typed}'`))
    .toBe("manual:-");
  expect(
    sql(
      `select a.metadata -> 'source' ->> 'type' from activity_event a join task t on t.id = a.source_id
       where t.title = '${typed}' and a.verb = 'created'`,
    ),
  ).toBe("manual");

  // A meeting action: the task names its meeting.
  const meetingTitle = `Source meeting ${suffix}`;
  await page.goto("/meetings");
  await clickWhenInteractive(page.getByRole("button", { name: "New meeting" }));
  const schedule = page.getByRole("dialog", { name: "Schedule meeting" });
  await schedule.getByLabel("Title").fill(meetingTitle);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await schedule.getByLabel("Starts").fill(`${tomorrow}T10:00`);
  await schedule.getByRole("button", { name: "Schedule" }).click();
  await expect(schedule).toBeHidden();
  await page.getByRole("link", { name: meetingTitle }).first().click();
  await expect(page.locator("h1").first()).toHaveText(meetingTitle);

  await page.getByRole("button", { name: "Add action" }).click();
  const act = page.getByRole("dialog", { name: "Add action" });
  await act.getByLabel("Action").fill(action);
  await act.getByRole("button", { name: "Create task" }).click();
  await expect(act).toBeHidden();

  const meetingId = sql(`select id from meeting where title = '${meetingTitle}'`);
  await expect
    .poll(() => sql(`select source_type || ':' || source_id from task where title = '${action}'`))
    .toBe(`meeting:${meetingId}`);
});
