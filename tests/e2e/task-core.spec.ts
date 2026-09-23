import { expect, test, type Page } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Acceptance evidence for #76 — the defects #29 and #30 left behind.
 *
 * These are the four that only a browser settles: that the blocked reason is
 * collected by a real dialog and cleared when the task is unblocked, that a
 * label can be created and attached and then actually narrows a filter, that
 * an approver can be named after creation and the name survives a reload, and
 * that somebody with read access has none of these controls.
 *
 * The rest of the issue is covered by the unit suite and by
 * supabase/tests/task-core-followups.sql.
 */

async function createTask(page: Page, title: string) {
  await page.goto("/my-work?create=task");
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog
    .getByLabel("Assignee", { exact: true })
    .selectOption({ label: "QA Owner" });
  await dialog.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/create=task/, { timeout: 30_000 });
  const id = sql(`select id::text from task where title = '${title}' limit 1`);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id;
}

test("blocking a task asks for a reason in a dialog, and unblocking clears it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Blocked reason ${Date.now()}`;
  const taskId = await createTask(page, title);
  await page.goto(`/my-work?task=${taskId}`);

  const drawer = page.getByRole("dialog").first();
  await expect(drawer.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  // `window.prompt` returns null under Playwright unless a handler is
  // registered, so if the old control were still here this selection would
  // silently do nothing and the assertions below would fail on an unchanged
  // status. That makes this a real check on the replacement, not just on the
  // dialog's appearance.
  await drawer.getByLabel("Task status").selectOption("blocked");

  const ask = page.getByRole("dialog", { name: `What is blocking “${title}”?` });
  await expect(ask).toBeVisible({ timeout: 30_000 });

  // A required field the browser refuses to submit empty, which is the part
  // window.prompt could never do.
  const reason = ask.getByLabel("Reason", { exact: true });
  await expect(reason).toHaveAttribute("required", "");
  await expect(ask.getByRole("button", { name: "Mark blocked" })).toBeDisabled();

  await reason.fill("Waiting on the signed venue contract.");
  await ask.getByRole("button", { name: "Mark blocked" }).click();
  await expect(ask).not.toBeVisible({ timeout: 30_000 });

  await expect
    .poll(
      () =>
        sql(
          `select status || '|' || coalesce(blocked_reason, 'none')
           from task where id = '${taskId}'`,
        ),
      { timeout: 30_000 },
    )
    .toBe("blocked|Waiting on the signed venue contract.");

  // Leaving `blocked` clears the reason: an explanation for a blockage that
  // has been declared over is not an explanation of anything, and the board
  // went on printing it above an in-progress task.
  // Reopen the drawer by asking for it, not by reloading whatever the URL
  // happens to say. Giving a blocking reason closes the drawer, and closing it
  // drops `?task=` from the URL (task-drawer.tsx `close`). A bare reload
  // therefore lands on a plain /my-work with no drawer at all, and only passed
  // before because the reload usually beat the router's replace. CI run
  // 35875933334 is what it looks like when it loses: three minutes of waiting
  // for a dialog that was never going to open.
  await page.goto(`/my-work?task=${taskId}`);
  await page
    .getByRole("dialog")
    .first()
    .getByLabel("Task status")
    .selectOption("in_progress");

  await expect
    .poll(
      () =>
        sql(
          `select status || '|' || coalesce(blocked_reason, 'none')
           from task where id = '${taskId}'`,
        ),
      { timeout: 30_000 },
    )
    .toBe("in_progress|none");
});

test("a label can be created, attached, filtered by, and taken off again", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  const labelled = `Labelled task ${stamp}`;
  const plain = `Unlabelled task ${stamp}`;
  const labelName = `Fundraising ${stamp}`;

  const labelledId = await createTask(page, labelled);
  await createTask(page, plain);

  await page.goto(`/my-work?task=${labelledId}`);
  const drawer = page.getByRole("dialog").first();
  const labels = drawer.getByRole("region", { name: "Labels" });
  await expect(labels).toBeVisible({ timeout: 30_000 });

  await labels.getByRole("button", { name: "Add label" }).click();
  await labels.getByLabel("Or make a new one").fill(labelName);
  await labels.getByRole("button", { name: "Create", exact: true }).click();

  // Nothing in the product wrote to either table before this, so the row
  // existing at all is the claim being made.
  await expect
    .poll(
      () =>
        sql(
          `select count(*)::text from task_label tl
           join label l on l.id = tl.label_id
           where tl.task_id = '${labelledId}' and l.name = '${labelName}'`,
        ),
      { timeout: 30_000 },
    )
    .toBe("1");

  await expect(labels.getByText(labelName)).toBeVisible({ timeout: 30_000 });

  // The filter has offered a label picker since #30 with nothing to pick and
  // nothing to match. This is the first time choosing one narrows anything.
  const labelId = sql(`select id::text from label where name = '${labelName}'`);
  await page.goto(`/my-work?label=${labelId}`);
  await expect(page.getByText(labelled, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(plain, { exact: true })).toHaveCount(0);

  // And taking it off puts the task back outside the filter.
  await page.goto(`/my-work?task=${labelledId}`);
  await page
    .getByRole("dialog")
    .first()
    .getByRole("button", { name: `Remove label ${labelName}` })
    .click();

  await expect
    .poll(
      () =>
        sql(`select count(*)::text from task_label where task_id = '${labelledId}'`),
      { timeout: 30_000 },
    )
    .toBe("0");
});

test("an approver can be named after the task exists, and the change is in its history", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Approver ${Date.now()}`;
  const taskId = await createTask(page, title);
  await page.goto(`/my-work?task=${taskId}`);

  const drawer = page.getByRole("dialog").first();
  // `approver_id` has had a column, a command and an RLS grant since
  // 20260912040000 and no control anywhere until now.
  await drawer.getByLabel("Approver", { exact: true }).selectOption({
    label: "QA Staff",
  });

  await expect
    .poll(
      () =>
        sql(
          `select coalesce(p.full_name, 'none') from task t
           left join user_profile p on p.id = t.approver_id
           where t.id = '${taskId}'`,
        ),
      { timeout: 30_000 },
    )
    .toBe("QA Staff");

  await page.reload();
  await expect(
    page.getByRole("dialog").first().getByLabel("Approver", { exact: true }),
  ).toHaveValue(sql(`select approver_id::text from task where id = '${taskId}'`));

  // Before #76 the history said "updated" with empty metadata for this, because
  // approver was not one of the five tracked fields.
  const summary = sql(
    `select summary from activity_event
     where source_type = 'task' and source_id = '${taskId}'
       and summary like '%Approver%' limit 1`,
  );
  expect(summary).toContain("set Approver to QA Staff");
});

test("a follower sees a task's labels without any way to change them", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const title = `Follower view ${Date.now()}`;
  const taskId = await createTask(page, title);

  // A follower is the honest denial case: `app.has_task_capability` grants the
  // role read and follow and withholds collaborate, so the person can see the
  // task and its labels and the policy refuses the write. Picking somebody
  // with no access at all would pass the same assertions for the wrong
  // reason — the controls would be missing because the whole task was.
  const volunteerId = sql(
    "select id::text from auth.users where email = 'qa-volunteer@example.com'",
  );
  sql(
    `insert into task_assignment (task_id, user_id, role)
     values ('${taskId}', '${volunteerId}', 'follower')`,
  );

  await signIn(page, "volunteer");
  await page.goto(`/my-work?task=${taskId}`);

  const drawer = page.getByRole("dialog").first();
  // Proves the task really is readable, so the absent controls below mean
  // "not allowed" rather than "not found".
  await expect(drawer.getByText(title, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(drawer.getByRole("region", { name: "Labels" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(drawer.getByRole("button", { name: "Add label" })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: /^Remove label / })).toHaveCount(0);

  // And the database agrees with what the interface withheld.
  expect(
    sql(
      `select public.has_task_capability('${taskId}', 'collaborate')::text
       from (select set_config('request.jwt.claims',
         json_build_object('sub', '${volunteerId}', 'role', 'authenticated',
                           'aal', 'aal2')::text, true)) _`,
    ),
  ).toBe("false");
});
