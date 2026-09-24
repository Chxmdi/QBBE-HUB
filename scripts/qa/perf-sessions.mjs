#!/usr/bin/env node
// Signs in the 50 performance users and writes their session cookies, plus the
// record ids the load test visits, for scripts/qa/perf.k6.js (#115).
//
// The cookies come from @supabase/ssr's own server client, the library the app
// reads them with, so their names, chunking and encoding are whatever the app
// expects rather than a copy of its format. Local or CI only.
//
//   node scripts/qa/perf-sessions.mjs [out=perf-sessions.json]

import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const OUT = process.argv[2] ?? "perf-sessions.json";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
  console.error(`Refusing to run against ${url}: the performance fixture is local only.`);
  process.exit(1);
}

const sudo = spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0;
function sql(statement) {
  const argv = ["exec", "-i", "supabase_db_workspace", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
  const result = spawnSync(sudo ? "sudo" : "docker", sudo ? ["docker", ...argv] : argv, { input: statement, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

async function cookieHeaderFor(email) {
  const jar = new Map();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: "QaTest!2026" });
  if (error) throw new Error(`${email}: ${error.message}`);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

const emails = Array.from({ length: 50 }, (_, i) => `qa-perf-${String(i + 1).padStart(2, "0")}@example.com`);
const users = [];
for (const email of emails) users.push({ email, cookie: await cookieHeaderFor(email) });

const projects = sql(`select id from project where name like 'Perf Project %' order by name`).split("\n").filter(Boolean);
const channel = sql(`select id from channel where slug = 'perf-general'`);
if (projects.length !== 10 || !channel) {
  console.error("The performance fixture is missing: run supabase/tests/perf-fixture.sql first.");
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify({ users, projects, channel }));
console.log(`Wrote ${users.length} sessions, ${projects.length} projects and the channel to ${OUT}.`);
