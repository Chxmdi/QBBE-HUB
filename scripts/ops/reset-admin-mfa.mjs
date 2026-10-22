#!/usr/bin/env node
// Break-glass reset of an owner's or admin's two-step verification, when they
// have lost every authenticator. Follow docs/runbooks/account-recovery.md:
// it requires an identity check and two named approvers before this is run.
//
//   read -rs SUPABASE_SERVICE_ROLE_KEY; export SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL=https://<ref>.supabase.co node scripts/ops/reset-admin-mfa.mjs \
//     --email person@qbbe.org --approved-by approver1@qbbe.org \
//     --approved-by approver2@qbbe.org --operator you@qbbe.org \
//     --reason "lost phone, identity checked by video call" [--dry-run]
//
// People are found by the address they sign in with, matched exactly. It
// refuses unless: the target is an active owner or admin; there are two
// approvers who are two different accounts, each an active owner or admin of
// the same organization and neither the target; the operator names
// themselves; and a reason is given. It writes an audit row ("started") first
// and stops if that fails, removes every factor of the target, then writes a
// second row with the outcome ("success" or "failed").
// The person is then sent to set up a new authenticator at their next
// sign-in. It never prints the key.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export class RefusedError extends Error {}

/** A plain address: no wildcards, spaces, quotes or list separators. */
const PLAIN_ADDRESS = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function address(value, flag) {
  if (typeof value !== "string" || value.startsWith("--")) throw new RefusedError(`${flag} needs an address after it.`);
  const normalized = value.trim().toLowerCase();
  if (!PLAIN_ADDRESS.test(normalized)) throw new RefusedError(`${value} is not a plain e-mail address.`);
  return normalized;
}

export function parseArgs(argv) {
  const args = { approvers: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--email") args.email = address(argv[++i], flag);
    else if (flag === "--approved-by") args.approvers.push(address(argv[++i], flag));
    else if (flag === "--operator") args.operator = address(argv[++i], flag);
    else if (flag === "--reason") args.reason = argv[++i];
    else throw new RefusedError(`Unknown option ${flag}.`);
  }
  if (!args.email) throw new RefusedError("Give the person's address with --email.");
  if (!args.operator) throw new RefusedError("Give your own address with --operator: the audit record names who ran the reset.");
  if (typeof args.reason !== "string" || args.reason.trim().length < 10) {
    throw new RefusedError("Give a reason of at least 10 characters with --reason.");
  }
  if (args.approvers.length !== 2) throw new RefusedError("Exactly two approvers are required (--approved-by twice).");
  return args;
}

/**
 * The sign-in account for an address, matched exactly. People are found by
 * the address they sign in with (Auth), not by their profile's email, which
 * each person can edit.
 */
async function authUserByEmail(db, email) {
  const matches = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not read the sign-in accounts: ${error.message}`);
    const users = data?.users ?? [];
    matches.push(...users.filter((u) => (u.email ?? "").toLowerCase() === email));
    if (users.length < 1000) break;
  }
  if (matches.length > 1) throw new RefusedError(`More than one sign-in account uses ${email}.`);
  return matches[0] ?? null;
}

/** Organizations in which this user is an active owner or admin. */
async function adminOrganizations(db, userId) {
  const { data, error } = await db
    .from("organization_membership")
    .select("organization_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "admin"]);
  if (error) throw new Error(`Could not read memberships: ${error.message}`);
  return new Set((data ?? []).map((m) => m.organization_id));
}

export async function resetAdminMfa(db, args) {
  const target = await authUserByEmail(db, args.email);
  if (!target) throw new RefusedError(`No sign-in account uses ${args.email}.`);
  const targetOrgs = await adminOrganizations(db, target.id);
  if (targetOrgs.size === 0) throw new RefusedError(`${args.email} is not an active owner or admin. This reset is only for them.`);
  if (targetOrgs.size > 1) throw new RefusedError(`${args.email} is an owner or admin in several organizations; reset them from the Supabase dashboard.`);
  const [organizationId] = targetOrgs;

  const approvers = [];
  for (const email of args.approvers) {
    const approver = await authUserByEmail(db, email);
    if (!approver || !(await adminOrganizations(db, approver.id)).has(organizationId)) {
      throw new RefusedError(`${email} is not an active owner or admin of the same organization.`);
    }
    approvers.push(approver.id);
  }
  // Compared by account, not by the address typed.
  if (new Set(approvers).size !== 2) throw new RefusedError("The two approvers must be two different people.");
  if (approvers.includes(target.id)) throw new RefusedError("The person being reset cannot approve their own reset.");

  const { data: listed, error: listError } = await db.auth.admin.mfa.listFactors({ userId: target.id });
  if (listError) throw new Error(`Could not list the factors: ${listError.message}`);
  const factors = listed?.factors ?? [];
  if (args.dryRun) return { userId: target.id, factors: factors.length, removed: 0, dryRun: true };
  if (factors.length === 0) throw new RefusedError(`${args.email} has no factors to remove; they can set one up at their next sign-in.`);

  const record = (result, extra = {}) =>
    db.from("audit_event").insert({
      organization_id: organizationId,
      actor_id: null,
      actor_type: "operator",
      event_type: "security",
      action: "mfa.break_glass_reset",
      result,
      object_type: "user_profile",
      object_id: target.id,
      metadata: {
        operator: args.operator,
        approvers,
        reason: args.reason.trim().slice(0, 500),
        factors: factors.length,
        tool: "scripts/ops/reset-admin-mfa.mjs",
        ...extra,
      },
    });

  // One row before (nothing is removed if it cannot be written) and one after
  // with the outcome: audit rows are never edited.
  const { error: auditError } = await record("started");
  if (auditError) throw new Error(`Stopped before removing anything: the audit record could not be written (${auditError.message}).`);

  let removed = 0;
  let failure = null;
  for (const factor of factors) {
    const { error } = await db.auth.admin.mfa.deleteFactor({ id: factor.id, userId: target.id });
    if (error) {
      failure = error.message;
      break;
    }
    removed += 1;
  }
  const { error: finishError } = await record(failure ? "failed" : "success", { removed, ...(failure ? { error: failure } : {}) });
  if (failure) throw new Error(`Removed ${removed} of ${factors.length} factors, then failed: ${failure}. Run it again.`);
  if (finishError) throw new Error(`Removed all ${removed} factors, but could not write the outcome to the audit log (${finishError.message}). Record it in the incident register.`);
  return { userId: target.id, factors: factors.length, removed, dryRun: false };
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
