import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { sql } from "./db";

loadEnvConfig(process.cwd());

const VOLUNTEER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3";
const PASSWORD = "QaTest!2026";

function waitForSubscription(channel: RealtimeChannel) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscription failed: ${status}`));
      }
    });
  });
}

test("an open Realtime socket stops receiving rows immediately after access revocation", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  expect(url, "NEXT_PUBLIC_SUPABASE_URL is required").toBeTruthy();
  expect(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();

  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({
    email: "qa-volunteer@example.com",
    password: PASSWORD,
  });
  expect(signIn.error).toBeNull();

  const [organizationId, ownerId] = sql(`
    select m.organization_id || '|' || m.user_id
    from organization_membership m
    where m.role = 'owner' and m.status = 'active'
    order by m.joined_at
    limit 1;
  `).split("|");
  expect(organizationId).toBeTruthy();
  expect(ownerId).toBeTruthy();

  const channelId = randomUUID();
  const deniedMessageId = randomUUID();
  const deniedAfterReconnectId = randomUUID();
  const slug = `realtime-revocation-${channelId.slice(0, 8)}`;
  const receivedMessageIds: string[] = [];

  sql(`
    insert into channel (
      id, organization_id, name, slug, type, privacy, owner_id, created_by
    ) values (
      '${channelId}', '${organizationId}', 'Realtime revocation fixture', '${slug}',
      'custom', 'private', '${ownerId}', '${ownerId}'
    );
    insert into channel_access_grant (
      organization_id, channel_id, user_id, role, source, created_by
    ) values (
      '${organizationId}', '${channelId}', '${VOLUNTEER_ID}', 'member', 'direct', '${ownerId}'
    );
  `);

  const channel = client
    .channel(`realtime-revocation-${channelId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message", filter: `channel_id=eq.${channelId}` },
      (payload) => receivedMessageIds.push(String(payload.new.id)),
    );
  let reconnectedChannel: RealtimeChannel | null = null;

  try {
    await waitForSubscription(channel);

    // A fresh local Realtime tenant initializes its CDC worker lazily after the
    // first subscription. Retry control events so this assertion distinguishes
    // startup lag from a dead or unauthorized socket.
    let controlDelivered = false;
    for (let attempt = 0; attempt < 12 && !controlDelivered; attempt += 1) {
      const allowedMessageId = randomUUID();
      sql(`
        insert into message (id, organization_id, channel_id, author_id, body)
        values ('${allowedMessageId}', '${organizationId}', '${channelId}', '${ownerId}', 'authorized event');
      `);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      controlDelivered = receivedMessageIds.includes(allowedMessageId);
    }
    expect(controlDelivered, "an authorized control event must arrive before revocation").toBe(true);

    sql(`
      delete from channel_access_grant
      where channel_id = '${channelId}' and user_id = '${VOLUNTEER_ID}' and source = 'direct';
    `);

    const visibleAfterRevocation = await client.from("message").select("id").eq("channel_id", channelId);
    expect(visibleAfterRevocation.error).toBeNull();
    expect(visibleAfterRevocation.data).toEqual([]);

    sql(`
      insert into message (id, organization_id, channel_id, author_id, body)
      values ('${deniedMessageId}', '${organizationId}', '${channelId}', '${ownerId}', 'revoked event');
    `);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(receivedMessageIds).not.toContain(deniedMessageId);

    await client.removeChannel(channel);
    reconnectedChannel = client
      .channel(`realtime-revocation-reconnect-${channelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message", filter: `channel_id=eq.${channelId}` },
        (payload) => receivedMessageIds.push(String(payload.new.id)),
      );
    await waitForSubscription(reconnectedChannel);
    sql(`
      insert into message (id, organization_id, channel_id, author_id, body)
      values ('${deniedAfterReconnectId}', '${organizationId}', '${channelId}', '${ownerId}', 'revoked reconnect event');
    `);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(receivedMessageIds).not.toContain(deniedAfterReconnectId);
  } finally {
    if (reconnectedChannel) await client.removeChannel(reconnectedChannel);
    else await client.removeChannel(channel);
    await client.auth.signOut();
    sql(`delete from channel where id = '${channelId}';`);
  }
});
