#!/usr/bin/env node
// The 50-user load test against a hosted QBBE environment (#115, #55).
//
//   node scripts/qa/perf-staging.mjs prepare [out=perf-sessions.json]
//   node scripts/qa/perf-staging.mjs teardown
//
// `prepare` puts the performance fixture on the project (50 people, 1
// program, 10 projects, 2,000 tasks, a channel with 1,000 messages; the same
// shape as supabase/tests/perf-fixture.sql), gives each of the 50 people a
// password made up for this run only, signs them in and writes their
// session cookies for scripts/qa/perf.k6.js. The fixture is created once and
// kept; only the passwords change. `teardown` removes all of it.
//
// How it differs from the local fixture: people are created through the Auth
// admin API, not by writing auth.users, so the project's own new-user rules
// apply (invitations are inserted first, since sign-up is by invitation
// only), and no password is ever written down or committed.
//
// Hosted projects are reached over a direct database connection (PERF_DB_URL,
// run through psql; the workflow builds it from the project's database
// password the same way the deploy job connects) and the Auth admin API
// (people). Without PERF_DB_URL, SQL goes through the Supabase Management
// API's query endpoint with SUPABASE_ACCESS_TOKEN. The script refuses any
// project that is not the registered staging project: it never runs against
// production.
//
// Environment:
//   SUPABASE_PROJECT_REF, STAGING_SUPABASE_PROJECT_REF,
//   PERF_DB_URL or SUPABASE_ACCESS_TOKEN,
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//   SUPABASE_SERVICE_ROLE_KEY.
// With PERF_LOCAL=1 (the local stack, for checking this script), SQL goes
// through `docker exec … psql`, or through psql over PERF_DB_URL when set.

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const command = process.argv[2];
const OUT = process.argv[3] ?? "perf-sessions.json";
if (command !== "prepare" && command !== "teardown") {
  console.error("Usage: perf-staging.mjs <prepare [out]|teardown>");
  process.exit(2);
}

const local = process.env.PERF_LOCAL === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref = process.env.SUPABASE_PROJECT_REF;
const stagingRef = process.env.STAGING_SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const dbUrl = process.env.PERF_DB_URL;

function need(name, value) {
  if (!value) {
    console.error(`${name} is required.`);
    process.exit(1);
  }
}
need("NEXT_PUBLIC_SUPABASE_URL", url);
need("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
need("SUPABASE_SERVICE_ROLE_KEY", serviceKey);

if (local) {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    console.error(`PERF_LOCAL=1 but ${url} is not the local stack.`);
    process.exit(1);
  }
} else {
  need("SUPABASE_PROJECT_REF", ref);
  need("STAGING_SUPABASE_PROJECT_REF", stagingRef);
  if (!dbUrl) need("SUPABASE_ACCESS_TOKEN", accessToken);
  // Staging only, by registration and by the address the people sign in to.
  if (!/^[a-z]{20}$/.test(ref) || ref !== stagingRef) {
    console.error("Refusing: SUPABASE_PROJECT_REF is not the registered staging project. This script never runs against production.");
    process.exit(1);
  }
  if (url.replace(/\/$/, "") !== `https://${ref}.supabase.co`) {
    console.error(`Refusing: NEXT_PUBLIC_SUPABASE_URL (${url}) is not project ${ref}.`);
    process.exit(1);
  }
  // The direct connection must be this project's too (Supabase user names
  // are postgres.<ref> on the pooler, postgres on the direct host).
  if (dbUrl && !new RegExp(`^postgres(ql)?://postgres(\\.${ref})?:[^@]*@(db\\.${ref}\\.supabase\\.co|[a-z0-9-]+\\.pooler\\.supabase\\.com)(:\\d+)?/postgres(\\?.*)?$`).test(dbUrl)) {
    console.error(`Refusing: PERF_DB_URL is not a connection to project ${ref}.`);
    process.exit(1);
  }
}

const COUNT = 50;
const PEOPLE = Array.from({ length: COUNT }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return { n: i + 1, email: `qa-perf-${n}@example.com`, name: `Perf Person ${n}`, role: i < 10 ? "staff" : "volunteer" };
});

// ---------------------------------------------------------------------------
// SQL: psql over PERF_DB_URL (or docker exec on the local stack); otherwise
// the Management API.
// ---------------------------------------------------------------------------

const PSQL_FLAGS = ["-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
const viaPsql = Boolean(dbUrl) || local;

async function query(sql) {
  if (dbUrl) {
    const result = spawnSync("psql", ["-X", ...PSQL_FLAGS, dbUrl], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  }
  if (local) {
    const sudo = spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0;
    const argv = ["exec", "-i", "supabase_db_workspace", "psql", "-U", "postgres", "-d", "postgres", ...PSQL_FLAGS];
    const result = spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...argv] : argv, { input: sql, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    return result.stdout.trim();
  }
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Management API ${response.status}: ${text.slice(0, 500)}`);
  return text;
}

/** Runs a statement for its effect. */
async function exec(sql) {
  await query(sql);
}

/** Runs a SELECT and returns its rows as objects. */
async function rows(sql) {
  // Both paths answer JSON: the psql path by wrapping the select.
  const text = viaPsql ? await query(`select coalesce(json_agg(t), '[]'::json) from (${sql}) as t;`) : await query(sql);
  return JSON.parse(text || "[]");
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

async function findUser(email) {
  const found = await rows(`select id from auth.users where email = '${email}'`);
  return found[0]?.id ?? null;
}

async function ensurePerson(person, password) {
  const existing = await findUser(person.email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, { password });
    if (error) throw new Error(`${person.email}: ${error.message}`);
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: person.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: person.name },
  });
  if (error) throw new Error(`${person.email}: ${error.message}`);
  return data.user.id;
}

async function seedPeople(orgId, ownerId, password) {
  // Sign-up is by invitation only: the invitation decides the role.
  await exec(`
    insert into invitation (organization_id, email, intended_role, invited_by, expires_at)
    select '${orgId}', p.email, p.role::org_role, '${ownerId}', now() + interval '1 day'
    from (values ${PEOPLE.map((p) => `('${p.email}', '${p.role}')`).join(", ")}) as p(email, role)
    where not exists (select 1 from auth.users u where u.email = p.email)
      and not exists (select 1 from invitation i where i.email = p.email and i.accepted_at is null and i.revoked_at is null and i.expires_at > now());
  `);
  for (const person of PEOPLE) await ensurePerson(person, password);
  await exec(`
    update user_profile set onboarded_at = coalesce(onboarded_at, now())
    where email like 'qa-perf-%@example.com';
  `);
}

async function seedData(orgId, ownerId) {
  const present = await rows(`select 1 as present from program where slug = 'perf-program'`);
  if (present.length > 0) {
    console.log("Performance data already present; keeping it.");
    return;
  }
  await exec(`
do $$
declare
  v_owner uuid := '${ownerId}';
  v_org uuid := '${orgId}';
  v_program uuid;
  v_channel uuid;
begin
  create temp table perf_people on commit drop as
    select row_number() over (order by u.email) as n, u.id
    from auth.users u where u.email like 'qa-perf-%@example.com';
  if (select count(*) from perf_people) <> ${COUNT} then
    raise exception 'Expected ${COUNT} performance people, found %', (select count(*) from perf_people);
  end if;

  insert into program (organization_id, name, slug, description, lead_id, created_by)
  values (v_org, 'Performance Program', 'perf-program', 'Synthetic load fixture.', v_owner, v_owner)
  returning id into v_program;

  insert into project (organization_id, program_id, name, outcome, owner_id, stage, health, start_date, target_date, created_by)
  select v_org, v_program, format('Perf Project %s', lpad(p::text, 2, '0')),
         'Synthetic project for load measurement.', v_owner, 'active', 'on_track',
         current_date - 30, current_date + 90, v_owner
  from generate_series(1, 10) as p;

  -- Each project: staff 1..10 cycle, volunteers spread so each has work.
  insert into project_access_grant (organization_id, project_id, user_id, role, source, created_by)
  select v_org, pr.id, pp.id, 'contributor', 'direct', v_owner
  from project pr
  cross join lateral (select substring(pr.name from '(\\d+)$')::int as pr_n) as n
  cross join lateral (
    select ((n.pr_n + k) % 10) + 1 as u from generate_series(0, 4) as k
    union
    select 11 + ((n.pr_n * 4 + k) % 40) as u from generate_series(0, 7) as k
  ) as members
  join perf_people pp on pp.n = members.u
  where pr.program_id = v_program;

  insert into task (organization_id, project_id, title, status, priority, assignee_id, created_by, due_at, sort_key,
                    blocked_reason, completed_at)
  select v_org, pr.id,
         format('Perf task %s', t),
         (array['not_started', 'in_progress', 'blocked', 'completed'])[1 + t % 4]::task_status,
         (array['low', 'medium', 'high', 'critical'])[1 + t % 4]::task_priority,
         g.user_id,
         v_owner,
         now() + ((t % 60) - 20) * interval '1 day',
         t,
         case when t % 4 = 2 then 'Waiting on the venue' end,
         case when t % 4 = 3 then now() - (t % 30) * interval '1 day' end
  from generate_series(1, 2000) as t
  join lateral (
    select id from project where program_id = v_program order by name offset (t % 10) limit 1
  ) as pr on true
  join lateral (
    select user_id from project_access_grant
    where project_id = pr.id and source = 'direct'
    order by user_id offset (t % 13) limit 1
  ) as g on true;

  insert into channel (organization_id, name, slug, type, privacy, owner_id, created_by)
  values (v_org, 'perf-general', 'perf-general', 'custom', 'public', v_owner, v_owner)
  returning id into v_channel;

  insert into channel_member (channel_id, user_id)
  select v_channel, id from perf_people;

  insert into message (organization_id, channel_id, author_id, body, created_at)
  select v_org, v_channel,
         (select id from perf_people where n = 1 + m % ${COUNT}),
         format('Perf message %s about the spring schedule', m),
         now() - (1000 - m) * interval '1 minute'
  from generate_series(1, 1000) as m;
end
$$;
  `);
  console.log("Performance data created: 1 program, 10 projects, 2,000 tasks, 1 channel with 1,000 messages.");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Signs one person in; hosted Auth limits sign-ins per address, so a 429 waits and tries again. */
async function cookieHeaderFor(email, password) {
  for (let attempt = 1; ; attempt += 1) {
    const jar = new Map();
    const client = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
      },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const limited = error.status === 429 || /rate limit/i.test(error.message);
    if (!limited || attempt >= 24) throw new Error(`${email}: ${error.message}`);
    console.log(`Sign-in rate limited at ${email}; waiting 15 s (attempt ${attempt}).`);
    await sleep(15_000);
  }
}

async function prepare() {
  const owner = await rows(`
    select m.user_id, m.organization_id from organization_membership m
    where m.role = 'owner' and m.status = 'active' order by m.created_at limit 1
  `);
  if (owner.length === 0) throw new Error("No active owner found; the workspace has not been set up.");
  const ownerId = owner[0].user_id;
  const orgId = owner[0].organization_id;

  // 32 random bytes, for this run only; never printed, never stored.
  const password = randomBytes(32).toString("base64url");
  await seedPeople(orgId, ownerId, password);
  console.log(`${COUNT} performance people are in place with a password for this run.`);
  await seedData(orgId, ownerId);

  const users = [];
  for (const person of PEOPLE) users.push({ email: person.email, cookie: await cookieHeaderFor(person.email, password) });

  const projects = (await rows(`select id from project where name like 'Perf Project %' order by name`)).map((r) => r.id);
  const channel = (await rows(`select id from channel where slug = 'perf-general'`))[0]?.id;
  if (projects.length !== 10 || !channel) throw new Error("The performance data is incomplete: run teardown, then prepare again.");

  writeFileSync(OUT, JSON.stringify({ users, projects, channel }));
  console.log(`Wrote ${users.length} sessions, ${projects.length} projects and the channel to ${OUT}.`);
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

async function teardown() {
  await exec(`
    delete from message where channel_id in (select id from channel where slug = 'perf-general');
    delete from channel_member where channel_id in (select id from channel where slug = 'perf-general');
    delete from channel where slug = 'perf-general';
    delete from task where project_id in (select id from project where program_id in (select id from program where slug = 'perf-program'));
    delete from project_access_grant where project_id in (select id from project where program_id in (select id from program where slug = 'perf-program'));
    delete from project where program_id in (select id from program where slug = 'perf-program');
    delete from program where slug = 'perf-program';
    delete from invitation where email like 'qa-perf-%@example.com';
  `);
  let removed = 0;
  for (const person of PEOPLE) {
    const id = await findUser(person.email);
    if (!id) continue;
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`${person.email}: ${error.message}`);
    removed += 1;
  }
  console.log(`Performance fixture removed (${removed} people).`);
}

try {
  if (command === "prepare") await prepare();
  else await teardown();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
