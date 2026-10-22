#!/usr/bin/env node
// Proves a signed-in person can read data through the API after a deploy.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> \
//   SMOKE_EMAIL=<smoke user> SMOKE_PASSWORD=<password> node scripts/ci/smoke-signed-in.mjs
//
// The site answering /sign-in says nothing about the database: a project
// whose tables are not granted to the API roles deploys green and then
// refuses every signed-in query ("permission denied"), which the app shows as
// a silent redirect back to /sign-in. This signs in as a dedicated smoke user
// (lowest role, one test program, no MFA) and reads that person's own
// membership row, which row-level security allows. It prints one line and
// exits 0 on success, 1 otherwise. It never prints a key, password or token.
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_EMAIL, SMOKE_PASSWORD } = process.env;
for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, SMOKE_EMAIL, SMOKE_PASSWORD })) {
  if (!value) {
    console.error(`Signed-in smoke check: ${name} is not set.`);
    process.exit(1);
  }
}

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: session, error: signInError } = await db.auth.signInWithPassword({
  email: SMOKE_EMAIL,
  password: SMOKE_PASSWORD,
});
if (signInError || !session.user) {
  console.error(`Signed-in smoke check: the smoke user could not sign in (${signInError?.message ?? "no user"}).`);
  process.exit(1);
}

const { data, error } = await db
  .from("organization_membership")
  .select("organization_id, role, status")
  .eq("user_id", session.user.id)
  .limit(1);
await db.auth.signOut();

if (error) {
  const hint = error.code === "42501" ? " The API roles are missing table grants; see AGENTS.md (auto_expose_new_tables)." : "";
  console.error(`Signed-in smoke check: reading the smoke user's membership failed: ${error.code ?? ""} ${error.message}.${hint}`);
  process.exit(1);
}
if (!data?.length) {
  console.error("Signed-in smoke check: the smoke user has no membership row. Add them to the organization (lowest role).");
  process.exit(1);
}
console.log(`Signed-in smoke check: signed in and read 1 membership row (role ${data[0].role}, ${data[0].status}).`);
