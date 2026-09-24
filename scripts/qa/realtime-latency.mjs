#!/usr/bin/env node
// Realtime latency probe (#113, QA-FINAL "realtime <= 5 s").
//
// One signed-in member posts N messages into a private channel; another
// signed-in member receives them over Realtime. Latency is receive time minus
// send time, both on this process's clock, so no clock skew enters it. Prints
// p50, p95 and max, and exits 1 when p95 exceeds the target.
//
// Local or CI only: the channel and grants are created through the local
// database container, and nothing here can reach a hosted project.
//
//   node scripts/qa/realtime-latency.mjs [--messages 30] [--interval 250] [--target 5000]

import { spawnSync } from "node:child_process";
import { randomUUID as uuid } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (i % 2 === 0 ? [...pairs, [value.replace(/^--/, ""), all[i + 1]]] : pairs), []),
);
const MESSAGES = Number(args.messages ?? 30);
const INTERVAL_MS = Number(args.interval ?? 250);
const TARGET_MS = Number(args.target ?? 5000);
const PASSWORD = "QaTest!2026";
const OWNER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const SENDER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3"; // qa-volunteer
const RECEIVER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2"; // qa-staff
const CONTAINER = "supabase_db_workspace";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to run against ${url}: this probe creates fixtures and is local only.`);
  process.exit(1);
}

const sudo = spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0;
function sql(statement) {
  const argv = ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
  const result = spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...argv] : argv, { input: statement, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function signedIn(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`${email}: ${error.message}`);
  await client.realtime.setAuth(data.session.access_token);
  return client;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

const organizationId = sql(`select organization_id from organization_membership where user_id = '${OWNER_ID}' limit 1`);
const channelId = uuid();
sql(`
  insert into channel (id, organization_id, name, slug, type, privacy, owner_id, created_by)
  values ('${channelId}', '${organizationId}', 'Latency probe', 'latency-probe-${channelId.slice(0, 8)}',
          'custom', 'private', '${OWNER_ID}', '${OWNER_ID}');
  insert into channel_access_grant (organization_id, channel_id, user_id, role, source, created_by)
  select '${organizationId}', '${channelId}', u, 'member', 'direct', '${OWNER_ID}'
  from unnest(array['${SENDER_ID}'::uuid, '${RECEIVER_ID}'::uuid]) as u;
`);

const sender = await signedIn("qa-volunteer@example.com");
const receiver = await signedIn("qa-staff@example.com");
const sentAt = new Map();
const latencies = [];

const channel = receiver
  .channel(`latency-${channelId}`)
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "message", filter: `channel_id=eq.${channelId}` }, (payload) => {
    const started = sentAt.get(payload.new.body);
    if (started !== undefined) latencies.push(Date.now() - started);
  });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Realtime subscription timed out")), 15_000);
  // "SUBSCRIBED" is the topic join; Realtime listens to Postgres only once it
  // sends this system message, and anything sent before then is never delivered.
  channel.on("system", {}, (payload) => {
    if (payload.extension !== "postgres_changes") return;
    clearTimeout(timer);
    if (payload.status === "ok") resolve();
    else reject(new Error(`Realtime could not listen to Postgres: ${JSON.stringify(payload)}`));
  });
  channel.subscribe((status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error(status)); }
  });
});

for (let i = 0; i < MESSAGES; i += 1) {
  const body = `latency ${i} ${uuid().slice(0, 8)}`;
  sentAt.set(body, Date.now());
  const { error } = await sender.from("message").insert({ organization_id: organizationId, channel_id: channelId, author_id: SENDER_ID, body });
  if (error) throw new Error(`send ${i}: ${error.message}`);
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
// Let the last message land, up to the target, before counting losses.
const deadline = Date.now() + TARGET_MS;
while (latencies.length < MESSAGES && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));

await receiver.removeChannel(channel);
sql(`delete from message where channel_id = '${channelId}'; delete from channel where id = '${channelId}';`);

const sorted = [...latencies].sort((a, b) => a - b);
const summary = {
  messages: MESSAGES,
  received: sorted.length,
  p50_ms: sorted.length ? percentile(sorted, 50) : null,
  p95_ms: sorted.length ? percentile(sorted, 95) : null,
  max_ms: sorted.length ? sorted[sorted.length - 1] : null,
  target_p95_ms: TARGET_MS,
};
console.log(JSON.stringify(summary));
const lost = MESSAGES - sorted.length;
if (lost > 0) console.error(`${lost} of ${MESSAGES} messages never arrived within the target.`);
process.exit(lost === 0 && summary.p95_ms <= TARGET_MS ? 0 : 1);
