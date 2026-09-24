import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "./fixtures";
import { signIn } from "./auth";
import { sql } from "./db";

loadEnvConfig(process.cwd());

/**
 * Realtime delivery (#113, QA-FINAL "realtime allow + deny"). The revocation
 * spec proves an open socket stops receiving once access is withdrawn; this
 * proves the other half: that a message reaches the people who may see it,
 * in the page, without a reload, inside the 5-second target, and that
 * someone who never had access receives nothing on the same socket path.
 */

const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const PASSWORD = "QaTest!2026";
const REALTIME_TARGET_MS = 5_000;

function privateChannelFor(members: string[]) {
  const [organizationId] = sql(`
    select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1;
  `).split("\n");
  const channelId = randomUUID();
  sql(`
    insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
    values ('${channelId}', '${organizationId}', 'Realtime delivery ${channelId.slice(0, 8)}',
            'realtime-delivery-${channelId.slice(0, 8)}', 'custom', 'private', '${OWNER_ID}', '${OWNER_ID}');
    insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
    select '${organizationId}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
    from unnest(array[${members.map((m) => `'${m}'::uuid`).join(",")}]) as u;
  `);
  return { channelId, organizationId };
}

async function apiClient(email: string): Promise<SupabaseClient> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(error, `${email} signs in`).toBeNull();
  return client;
}

function subscribe(client: SupabaseClient, channelId: string, received: string[]) {
  return new Promise<RealtimeChannel>((resolve, reject) => {
    const channel = client
      .channel(`delivery-${channelId}-${randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message", filter: `channel_id=eq.${channelId}` },
        (payload) => received.push(String(payload.new.body)),
      );
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(channel);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

test("a message posted in a channel appears for another member without a reload", async ({ browser }) => {
  test.setTimeout(120_000);
  const { channelId } = privateChannelFor([OWNER_ID, VOLUNTEER_ID]);

  const senderContext = await browser.newContext();
  const readerContext = await browser.newContext();
  const sender = await senderContext.newPage();
  const reader = await readerContext.newPage();

  await signIn(sender, "owner");
  await signIn(reader, "volunteer");
  await reader.goto(`/channels/${channelId}`);
  await sender.goto(`/channels/${channelId}`);
  // Wait for the reader's socket to have joined; before that the page is
  // rendered but not yet listening.
  await expect(reader.locator('[data-realtime="live"]')).toBeVisible({ timeout: 15_000 });

  const body = `Delivered live ${randomUUID().slice(0, 8)}`;
  await sender.getByRole("textbox", { name: "Write a message…" }).fill(body);
  await sender.getByRole("button", { name: "Send message" }).click();
  // The clock starts once the message exists — when the sender's own page
  // shows it saved — so the measurement is delivery, not the save round-trip.
  await expect(sender.getByText(body, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const savedAt = Date.now();

  // No reload on the reader's side: the text has to arrive over the socket.
  // The wait is longer than the target so a failure says whether delivery was
  // slow or never happened; the target itself is asserted on the measurement.
  // .first(): the text also reaches the page's live announcement for screen
  // readers, so it can match more than once.
  await expect(reader.getByText(body, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - savedAt;
  test.info().annotations.push({ type: "realtime-ms", description: String(elapsed) });
  expect(elapsed, `message reached the other member ${elapsed} ms after it was saved`).toBeLessThan(
    REALTIME_TARGET_MS,
  );

  await senderContext.close();
  await readerContext.close();
});

test("someone who was never given the channel receives none of its messages", async () => {
  test.setTimeout(60_000);
  const { channelId, organizationId } = privateChannelFor([VOLUNTEER_ID]);

  const member = await apiClient("qa-volunteer@example.com");
  const outsider = await apiClient("qa-guest@example.com");
  const memberReceived: string[] = [];
  const outsiderReceived: string[] = [];
  const memberChannel = await subscribe(member, channelId, memberReceived);
  const outsiderChannel = await subscribe(outsider, channelId, outsiderReceived);

  const body = `Members only ${randomUUID().slice(0, 8)}`;
  sql(`
    insert into message (organization_id, channel_id, author_id, body)
    values ('${organizationId}', '${channelId}', '${OWNER_ID}', '${body}');
  `);

  // The member's copy proves the event was published; only then does the
  // outsider's silence mean anything.
  await expect.poll(() => memberReceived, { timeout: REALTIME_TARGET_MS }).toContain(body);
  // Give the outsider the same window again before calling it silent.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  expect(outsiderReceived, "the outsider's socket carried nothing from the private channel").toEqual([]);

  const { data: readable } = await outsider.from("message").select("id").eq("channel_id", channelId);
  expect(readable ?? [], "nor can the outsider read it afterwards").toEqual([]);

  await member.removeChannel(memberChannel);
  await outsider.removeChannel(outsiderChannel);
});
