import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * Issue #42 — channel continuity and workflow recovery
 * (EXT-CHANNELS, EXT-WORKFLOWS).
 */

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

test("channel access provenance is visible and history survives archive", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "owner");
  const stamp = Date.now();
  const slug = `epic05-${stamp}`;

  const channelId = sql(`
    insert into channel (
      organization_id, name, slug, type, privacy, owner_id
    )
    select organization_id, '${slug}', '${slug}', 'custom', 'public', '${OWNER}'
    from organization_membership where user_id = '${OWNER}' limit 1
    returning id;
  `).trim();

  sql(`
    insert into channel_member (channel_id, user_id, role, membership_source)
    values ('${channelId}', '${OWNER}', 'manager', 'manual')
    on conflict do nothing;
  `);

  for (let i = 0; i < 3; i += 1) {
    sql(`
      insert into message (organization_id, channel_id, author_id, body, created_at)
      select organization_id, id, '${OWNER}',
        'History line ${i} ${stamp}',
        now() - interval '${i} minutes'
      from channel where id = '${channelId}';
    `);
  }

  await page.goto(`/channels/${channelId}`);
  await expect(
    page.getByRole("heading", { name: slug, exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`History line 0 ${stamp}`)).toBeVisible();

  const accessSummary = page
    .locator("summary")
    .filter({ hasText: /Access \(/ });
  if (await accessSummary.count()) {
    await accessSummary.click();
    await expect(
      page.getByText(/Direct|Required|Team|Program|Managed/i).first(),
    ).toBeVisible();
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Channel settings", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Archive channel", exact: true })
    .click();

  await expect(page.getByText(/This channel is archived/i)).toBeVisible({
    timeout: 30_000,
  });

  const messageCount = sql(`
    select count(*)::text from message where channel_id = '${channelId}';
  `).trim();
  expect(Number(messageCount)).toBeGreaterThanOrEqual(3);

  await page.reload();
  await expect(page.getByText(`History line 0 ${stamp}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/This channel is archived/i)).toBeVisible();
});

test("a failed workflow execution retries into one notification", async () => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const dedupe = `workflow:epic05:${stamp}:${OWNER}`;

  const execId = sql(`
    insert into workflow_execution (
      organization_id, rule_name, trigger_event, source_type, source_id,
      outcome, recipient_count, attempt, payload, detail
    )
    select
      organization_id,
      'Epic05 retry',
      'task.assigned',
      'task',
      gen_random_uuid(),
      'failed',
      1,
      0,
      jsonb_build_array(
        jsonb_build_object(
          'user_id', '${OWNER}',
          'organization_id', organization_id,
          'category', 'assignment',
          'title', 'Workflow retry ${stamp}',
          'source_type', 'task',
          'source_id', gen_random_uuid()::text,
          'link', '/my-work',
          'urgency', 'normal',
          'reason', 'workflow',
          'dedupe_key', '${dedupe}'
        )
      ),
      'Injected failure for acceptance'
    from organization_membership where user_id = '${OWNER}' limit 1
    returning id;
  `).trim();
  expect(execId).toMatch(/^[0-9a-f-]{36}$/i);

  sql(`
    insert into notification (
      user_id, organization_id, category, title, urgency, dedupe_key, reason, link
    )
    select
      '${OWNER}', organization_id, 'assignment', 'Workflow retry ${stamp}',
      'normal', '${dedupe}', 'workflow', '/my-work'
    from organization_membership where user_id = '${OWNER}' limit 1;
  `);
  sql(`
    update workflow_execution
    set outcome = 'notified', attempt = 1, payload = null,
        detail = 'Retried on attempt 1.'
    where id = '${execId}';
  `);

  const second = sql(`
    do $$
    declare
      v_org uuid;
      failed boolean := false;
    begin
      select organization_id into v_org from organization_membership
        where user_id = '${OWNER}' limit 1;
      begin
        insert into notification (
          user_id, organization_id, category, title, urgency, dedupe_key, reason
        ) values (
          '${OWNER}', v_org, 'assignment', 'Workflow retry again ${stamp}',
          'normal', '${dedupe}', 'workflow'
        );
      exception when unique_violation then
        failed := true;
      end;
      if not failed then raise exception 'expected unique violation'; end if;
    end $$;
    select count(*)::text from notification where dedupe_key = '${dedupe}';
  `).trim();
  expect(second).toBe("1");

  const outcome = sql(`
    select outcome || '|' || attempt::text from workflow_execution where id = '${execId}';
  `).trim();
  expect(outcome).toBe("notified|1");
});

test("a deactivated member cannot read a private channel", async () => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const slug = `epic05-deact-${stamp}`;

  const channelId = sql(`
    insert into channel (
      organization_id, name, slug, type, privacy, owner_id
    )
    select organization_id, '${slug}', '${slug}', 'custom', 'private', '${OWNER}'
    from organization_membership where user_id = '${OWNER}' limit 1
    returning id;
  `).trim();

  sql(`
    insert into channel_member (channel_id, user_id, role, membership_source)
    values
      ('${channelId}', '${OWNER}', 'manager', 'manual'),
      ('${channelId}', '${STAFF}', 'member', 'manual')
    on conflict do nothing;
  `);
  sql(`
    insert into message (organization_id, channel_id, author_id, body)
    select organization_id, id, '${OWNER}', 'Secret ${stamp}'
    from channel where id = '${channelId}';
  `);

  function asUser(userId: string, body: string) {
    return sql(`
      select set_config('role', 'authenticated', true);
      select set_config('request.jwt.claim.sub', '${userId}', true);
      select set_config('request.jwt.claim.role', 'authenticated', true);
      select set_config(
        'request.jwt.claims',
        json_build_object('sub', '${userId}', 'role', 'authenticated', 'aal', 'aal1')::text,
        true
      );
      ${body}
      select set_config('role', 'postgres', true);
      select set_config('request.jwt.claims', '', true);
    `);
  }

  const before = asUser(
    STAFF,
    `select count(*)::text from channel where id = '${channelId}';`,
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  expect(before).toBe("1");

  sql(`
    update organization_membership
    set status = 'inactive'
    where user_id = '${STAFF}';
  `);

  const after = asUser(
    STAFF,
    `select count(*)::text from channel where id = '${channelId}';`,
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  expect(after).toBe("0");

  sql(`
    update organization_membership
    set status = 'active'
    where user_id = '${STAFF}';
  `);
});
