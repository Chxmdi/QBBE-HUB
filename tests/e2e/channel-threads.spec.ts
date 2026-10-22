import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

const OWNER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const STAFF = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

/**
 * A channel opens on its newest 100 messages. Links to an older thread or
 * message (from a notification or search) used to open nothing; and the
 * notification bell kept the count it had when the page loaded.
 */
test("old threads and message links open, and the bell updates without a reload", async ({ page }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const slug = `threads-${stamp}`;
  const channelId = sql(`
    insert into channel (organization_id, name, slug, type, privacy, owner_id)
    select organization_id, '${slug}', '${slug}', 'custom', 'public', '${OWNER}'
    from organization_membership where user_id = '${OWNER}' limit 1
    returning id;
  `).trim();
  try {
    sql(`
      insert into channel_member (channel_id, user_id, role, membership_source)
      values ('${channelId}', '${OWNER}', 'manager', 'manual'), ('${channelId}', '${STAFF}', 'member', 'manual')
      on conflict do nothing;
    `);
    // An old root, then 120 newer top-level messages, then a reply to the root.
    const rootId = sql(`
      insert into message (organization_id, channel_id, author_id, body, created_at)
      select organization_id, id, '${OWNER}', 'Old root ${stamp}', now() - interval '3 hours'
      from channel where id = '${channelId}' returning id;
    `).trim();
    const oldId = sql(`
      insert into message (organization_id, channel_id, author_id, body, created_at)
      select organization_id, id, '${STAFF}', 'Old plain ${stamp}', now() - interval '170 minutes'
      from channel where id = '${channelId}' returning id;
    `).trim();
    sql(`
      insert into message (organization_id, channel_id, author_id, body, created_at)
      select c.organization_id, c.id, '${STAFF}', 'Filler ' || g || ' ${stamp}', now() - interval '2 hours' + g * interval '1 second'
      from channel c, generate_series(1, 120) g where c.id = '${channelId}';
    `);
    sql(`
      insert into message (organization_id, channel_id, author_id, thread_root_id, body)
      select organization_id, id, '${STAFF}', '${rootId}', 'Late reply ${stamp}'
      from channel where id = '${channelId}';
    `);

    await signIn(page, "owner");
    await page.goto(`/channels/${channelId}?thread=${rootId}`);
    const thread = page.getByRole("complementary", { name: "Thread" });
    await expect(thread.getByText(`Old root ${stamp}`)).toBeVisible({ timeout: 30_000 });
    await expect(thread.getByText(`Late reply ${stamp}`)).toBeVisible();

    await page.goto(`/channels/${channelId}?message=${oldId}`);
    await expect(page.locator(`#message-${oldId}[data-highlighted="true"]`)).toBeVisible({ timeout: 30_000 });

    // The bell: a new notification raises the count with no reload, and
    // after "mark all read" a new one shows 1.
    const bell = page.getByRole("button", { name: /^Notifications/ });
    sql(`
      insert into notification (user_id, organization_id, category, title, dedupe_key)
      select '${OWNER}', organization_id, 'mention', 'Bell seed ${stamp}', 'bell-seed:${stamp}'
      from organization_membership where user_id = '${OWNER}' limit 1;
    `);
    await expect(bell).toHaveAccessibleName(/Notifications \(\d+ unread\)/, { timeout: 30_000 });
    await bell.click();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(bell).toHaveAccessibleName("Notifications");
    await page.keyboard.press("Escape");
    sql(`
      insert into notification (user_id, organization_id, category, title, dedupe_key)
      select '${OWNER}', organization_id, 'mention', 'Bell check ${stamp}', 'bell-check:${stamp}'
      from organization_membership where user_id = '${OWNER}' limit 1;
    `);
    await expect(bell).toHaveAccessibleName("Notifications (1 unread)", { timeout: 30_000 });
  } finally {
    sql(`delete from notification where dedupe_key in ('bell-check:${stamp}', 'bell-seed:${stamp}')`);
    sql(`delete from channel where id = '${channelId}'`);
  }
});
