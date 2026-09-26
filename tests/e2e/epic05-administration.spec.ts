import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Issue #41 — administration (P0-ADM-01, P0-ADM-02, P1-ADM-03).
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";

test("material changes appear in Admin audit with actor and time", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");

  const stamp = Date.now();
  const taskTitle = `Audit task ${stamp}`;

  const taskId = sql(`
    do $$
    declare
      v_org uuid;
      v_task uuid;
    begin
      select organization_id into v_org from organization_membership
        where user_id = '${OWNER}' limit 1;
      perform set_config('request.jwt.claim.sub', '${OWNER}', true);
      perform set_config('request.jwt.claim.role', 'authenticated', true);
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', '${OWNER}', 'role', 'authenticated', 'aal', 'aal2')::text,
        true
      );
      insert into task (organization_id, title, created_by, status)
      values (v_org, '${taskTitle}', '${OWNER}', 'not_started')
      returning id into v_task;
      update task set due_at = current_date + 5 where id = v_task;
      update task set status = 'in_progress' where id = v_task;
      raise notice '%', v_task;
    end $$;
    select id::text from task where title = '${taskTitle}' limit 1;
  `).trim();
  expect(taskId).toMatch(/^[0-9a-f-]{36}$/i);

  await page.goto("/admin?audit=task.due_date");
  await expect(
    page.getByRole("heading", { name: "Audit history", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("task.due_date").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("QA Owner").first()).toBeVisible();

  await page.goto("/admin?audit=task.status");
  await expect(page.getByText("task.status").first()).toBeVisible({
    timeout: 30_000,
  });
});

test("a task and a document can be archived and restored", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const stamp = Date.now();
  const taskTitle = `Restore task ${stamp}`;
  const docTitle = `Restore doc ${stamp}`;

  sql(`
    insert into task (organization_id, title, created_by, status, archived_at)
    select organization_id, '${taskTitle}', '${OWNER}', 'not_started', now()
    from organization_membership where user_id = '${OWNER}' limit 1;
  `);
  sql(`
    insert into document (organization_id, title, kind, url, owner_id, created_by, visibility, archived_at)
    select organization_id, '${docTitle}', 'link',
      'https://drive.google.com/file/d/epic05-restore/view',
      '${OWNER}', '${OWNER}', 'organization', now()
    from organization_membership where user_id = '${OWNER}' limit 1;
  `);

  await page.goto("/my-work?archived=1");
  await expect(
    page.getByRole("heading", { name: "Archived tasks", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
  await page
    .locator("li")
    .filter({ hasText: taskTitle })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect
    .poll(
      () =>
        sql(
          `select archived_at is null from task where title = '${taskTitle}' limit 1;`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("t");

  await page.goto("/documents?archived=1");
  await expect(page.getByText(docTitle, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: `Actions for ${docTitle}` }).click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect
    .poll(
      () =>
        sql(
          `select archived_at is null from document where title = '${docTitle}' limit 1;`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("t");
});

test("an unapproved template cannot be used, and an approved one creates a clean record", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const stamp = Date.now();

  const draftId = sql(`
    insert into record_template (organization_id, kind, name, structure, created_by)
    select organization_id, 'task', 'Draft tpl ${stamp}',
      '{"title":"From draft ${stamp}"}'::jsonb, '${OWNER}'
    from organization_membership where user_id = '${OWNER}' limit 1
    returning id;
  `).trim();

  await page.goto("/admin/templates");
  await expect(
    page.getByRole("heading", { name: "Templates", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  const draftRow = page.locator("li").filter({ hasText: `Draft tpl ${stamp}` });
  await expect(draftRow.getByText("Draft", { exact: true })).toBeVisible();
  await draftRow
    .getByRole("button", { name: "Try to use", exact: true })
    .click();
  await expect(draftRow.getByText(/has not been approved/i)).toBeVisible({
    timeout: 15_000,
  });

  await draftRow.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(draftRow.getByText("Approved", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await draftRow.getByRole("button", { name: "Use", exact: true }).click();

  await expect
    .poll(
      () =>
        sql(
          `select count(*)::text from task where title = 'From draft ${stamp}';`,
        ).trim(),
      { timeout: 30_000 },
    )
    .toBe("1");

  const assignee = sql(`
    select coalesce(assignee_id::text, '') from task where title = 'From draft ${stamp}' limit 1;
  `).trim();
  expect(assignee).toBe("");

  // Approval was recorded.
  const approved = sql(`
    select approved_at is not null from record_template where id = '${draftId}';
  `).trim();
  expect(approved).toBe("t");
});
