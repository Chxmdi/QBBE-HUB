// One-off: block sign-in for people who were deactivated before the Hub
// started doing it at deactivation time.
//
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ban-deactivated-members.mjs          # lists them
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ban-deactivated-members.mjs --apply  # bans them
//
// A person is banned only when none of their memberships is active (a ban is
// account-wide). Reactivating someone in Admin lifts the ban. Reads the two
// values from the environment; it prints user ids, never keys.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: memberships, error } = await db
  .from("organization_membership")
  .select("user_id, status");
if (error) {
  console.error(`Could not read memberships: ${error.message}`);
  process.exit(1);
}
const active = new Set(memberships.filter((m) => m.status === "active").map((m) => m.user_id));
const leavers = [...new Set(memberships.filter((m) => m.status === "deactivated").map((m) => m.user_id))]
  .filter((id) => !active.has(id));

console.log(`${leavers.length} account(s) with no active membership.`);
let failed = 0;
for (const id of leavers) {
  if (!apply) {
    console.log(`would ban ${id}`);
    continue;
  }
  const { error: banError } = await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (banError) {
    failed += 1;
    console.error(`could not ban ${id}: ${banError.message}`);
  } else {
    console.log(`banned ${id}`);
  }
}
if (!apply) console.log("Nothing changed. Run again with --apply to ban them.");
process.exitCode = failed ? 1 : 0;
