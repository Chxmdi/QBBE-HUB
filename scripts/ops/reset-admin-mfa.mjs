#!/usr/bin/env node
// Break-glass reset of an owner's or admin's two-step verification, when they
// have lost every authenticator. Follow docs/runbooks/account-recovery.md:
// it requires an identity check and two named approvers before this is run.
//
//   read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL=https://<ref>.supabase.co node scripts/ops/reset-admin-mfa.mjs \
//     --email person@qbbe.org --approved-by approver1@qbbe.org \
//     --approved-by approver2@qbbe.org --reason "lost phone, identity checked by video call" [--dry-run]
//
// It refuses unless: the target is an active owner or admin; there are two
// different approvers, each an active owner or admin of the same organization
// and neither the target; and a reason is given. It writes the audit record
// first and stops if that fails, then removes every factor of the target.
// The person is then sent to set up a new authenticator at their next
// sign-in. It never prints the key.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export class RefusedError extends Error {}

export function parseArgs(argv) {
  const args = { approvers: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--email") args.email = argv[++i];
    else if (flag === "--approved-by") args.approvers.push(argv[++i]);
    else if (flag === "--reason") args.reason = argv[++i];
    else throw new RefusedError(`Unknown option ${flag}.`);
  }
  if (!args.email) throw new RefusedError("Give the person's address with --email.");
  if (!args.reason || args.reason.trim().length < 10) throw new RefusedError("Give a reason of at least 10 characters with --reason.");
  const approvers = [...new Set(args.approvers.map((a) => a.toLowerCase()))];
  if (approvers.length < 2) throw new RefusedError("Two different approvers are required (--approved-by twice).");
  if (approvers.includes(args.email.toLowerCase())) throw new RefusedError("The person being reset cannot approve their own reset.");
  return { ...args, approvers };
}

/** The active owner or admin membership of the person with this address, or null. */
async function adminMembership(db, email) {
  const { data: profile, error } = await db.from("user_profile").select("id, email").ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`)).maybeSingle();
  if (error) throw new Error(`Could not read the profile of ${email}: ${error.message}`);
  if (!profile) return null;
  const { data: membership, error: membershipError } = await db
    .from("organization_membership")
    .select("organization_id, role, status")
    .eq("user_id", profile.id)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (membershipError) throw new Error(`Could not read the membership of ${email}: ${membershipError.message}`);
  return membership ? { userId: profile.id, organizationId: membership.organization_id, role: membership.role } : null;
}

export async function resetAdminMfa(db, args) {
  const target = await adminMembership(db, args.email);
  if (!target) throw new RefusedError(`${args.email} is not an active owner or admin. This reset is only for them.`);
  const approvers = [];
  for (const email of args.approvers) {
    const approver = await adminMembership(db, email);
    if (!approver || approver.organizationId !== target.organizationId) {
      throw new RefusedError(`${email} is not an active owner or admin of the same organization.`);
    }
    approvers.push({ email, userId: approver.userId });
  }

  const { data: listed, error: listError } = await db.auth.admin.mfa.listFactors({ userId: target.userId });
  if (listError) throw new Error(`Could not list the factors: ${listError.message}`);
  const factors = listed?.factors ?? [];
  if (args.dryRun) return { userId: target.userId, factors: factors.length, removed: 0, dryRun: true };

  const { error: auditError } = await db.from("audit_event").insert({
    organization_id: target.organizationId,
    actor_id: approvers[0].userId,
    event_type: "security",
    action: "mfa.break_glass_reset",
    object_type: "user_profile",
    object_id: target.userId,
    metadata: {
      approvers: approvers.map((a) => a.userId),
      reason: args.reason.trim().slice(0, 500),
      factors: factors.length,
      tool: "scripts/ops/reset-admin-mfa.mjs",
    },
  });
  if (auditError) throw new Error(`Stopped before removing anything: the audit record could not be written (${auditError.message}).`);

  let removed = 0;
  for (const factor of factors) {
    const { error } = await db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.userId });
    if (error) throw new Error(`Removed ${removed} of ${factors.length} factors, then failed: ${error.message}. Run it again.`);
    removed += 1;
  }
  return { userId: target.userId, factors: factors.length, removed, dryRun: false };
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new RefusedError("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read -rs, never on the command line).");
  }
  const args = parseArgs(process.argv.slice(2));
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await resetAdminMfa(db, args);
  console.log(
    result.dryRun
      ? `Dry run: ${args.email} has ${result.factors} factor(s). Nothing was changed.`
      : `Removed ${result.removed} factor(s) for ${args.email} and recorded the reset in the audit log. They set up a new authenticator at their next sign-in.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof RefusedError ? `Refused: ${error.message}` : error.message);
    process.exit(1);
  });
}
