import { randomUUID } from "node:crypto";
import { expect, test, type Request } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

/**
 * What one new message costs a person who has the channel open. Each realtime
 * change used to make every viewer re-read the newest 100 messages and send
 * two read receipts (server actions with a session check and an UPDATE each).
 * Now it fetches the one message named by the change, and read receipts go
 * out at most once every 10 seconds.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";

test("one new message costs a viewer one small fetch and at most one read receipt", async ({ page }) => {
  test.setTimeout(90_000);
  const org = sql(
    `select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;`,
  ).split("\n")[0];
  const channelId = randomUUID();
  const suffix = channelId.slice(0, 8);
  sql(`
    insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values ('${channelId}', '${org}', 'Requests ${suffix}', 'requests-${suffix}', 'custom', 'private',
            '${OWNER_ID}', '${OWNER_ID}');
    insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    select '${org}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
    from unnest(array['${OWNER_ID}'::uuid, '${VOLUNTEER_ID}'::uuid]) as u;
    insert into message (organization_id, channel_id, author_id, body)
    select '${org}', '${channelId}', '${OWNER_ID}', 'Earlier message ' || g from generate_series(1, 5) g;
  `);

  await signIn(page, "volunteer");
  await page.goto(`/channels/${channelId}`);
  await expect(page.locator('[data-realtime="live"]')).toBeVisible({ timeout: 15_000 });
  // Let the opening read receipt and the going-live refetch settle first.
  await page.waitForTimeout(1_500);

  const messageReads: string[] = [];
  const receipts: Request[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() === "GET" && url.includes("/rest/v1/message?")) messageReads.push(url);
    if (request.method() === "POST" && request.headers()["next-action"]) receipts.push(request);
  });

  const body = `Live one ${suffix}`;
  sql(`
    insert into message (organization_id, channel_id, author_id, body)
    values ('${org}', '${channelId}', '${OWNER_ID}', '${body}');
  `);
  await expect(page.getByText(body, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(10_000);

  expect(messageReads, `message reads: ${messageReads.join("\n")}`).toHaveLength(1);
  expect(messageReads[0]).toContain("id=eq.");
  expect(messageReads[0]).not.toContain("limit=100");
  expect(receipts.length, "read receipts in 10 s").toBeLessThanOrEqual(1);
});
