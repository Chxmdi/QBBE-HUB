"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

/**
 * Year-end and accountant access (#154). Owners and admins who completed MFA
 * only; the database checks the same thing again, enforces every rule and
 * writes the audit record for each step.
 */

const LEDGER = "/finance/ledger";

// The ledger's own rules raise sentences written for people; anything else
// (row-level security, a network failure) gets a generic message.
const READABLE_CODES = new Set(["23514", "22023", "42501", "23505", "P0002"]);

function dbMessage(error: { code?: string; message: string } | null, fallback: string): string {
  if (!error) return fallback;
  if (
    error.code &&
    READABLE_CODES.has(error.code) &&
    !/row-level security|permission denied|violates check constraint/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

async function authorize(): Promise<
  { ok: true; organizationId: string } | { ok: false; result: ActionResult }
> {
  const auth = await authorizeAdminAction();
  if (!auth.ok) return { ok: false, result: { ok: false, error: auth.error } };
  const limited = await enforceRateLimit("ledger:write", auth.session.userId);
  if (limited) return { ok: false, result: limited };
  return { ok: true, organizationId: auth.session.organizationId };
}

const isoDate = (message: string) => requiredText(message).regex(/^\d{4}-\d{2}-\d{2}$/, message);

const grantSchema = z.object({
  userId: z.string({ message: "Choose the accountant." }).uuid("Choose the accountant."),
  expiresOn: isoDate("Choose the last day of access."),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

export async function grantAccountantAccess(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_grant_accountant", {
    p_organization: auth.organizationId,
    p_user: parsed.data.userId,
    p_expires_on: parsed.data.expiresOn,
    p_note: parsed.data.note || null,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not grant access. Try again.") };
  revalidatePath(`${LEDGER}/accountant`);
  return { ok: true };
}

export async function revokeAccountantAccess(grantId: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  if (!z.string().uuid().safeParse(grantId).success) return { ok: false, error: "Access not found." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_revoke_accountant", { p_grant: grantId });
  if (error) return { ok: false, error: dbMessage(error, "Could not revoke access. Try again.") };
  revalidatePath(`${LEDGER}/accountant`);
  return { ok: true };
}

const closeSchema = z.object({
  startsOn: isoDate("Choose the fiscal year."),
  confirm: z.literal(true, { message: "Confirm that the year is ready to close." }),
});

export async function closeFiscalYear(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_close_fiscal_year", {
    p_organization: auth.organizationId,
    p_starts_on: parsed.data.startsOn,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not close the year. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}

const reopenSchema = z.object({
  startsOn: isoDate("Choose the fiscal year."),
  reason: requiredText("Give the reason for reopening the year.", 500),
});

export async function reopenFiscalYear(input: unknown): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return auth.result;
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("ledger_reopen_fiscal_year", {
    p_organization: auth.organizationId,
    p_starts_on: parsed.data.startsOn,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: dbMessage(error, "Could not reopen the year. Try again.") };
  revalidatePath(LEDGER, "layout");
  return { ok: true };
}
