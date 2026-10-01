"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isEnabled } from "@/lib/feature-flags";
import { getLocale } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/translate";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { apiTokenMessages } from "../i18n";
import { apiScopes, generateToken, MAX_TOKEN_DAYS } from "../token";

/**
 * Making and revoking API tokens (V2-8), through the person's own session so
 * the api_token policies decide: a token is only ever made for yourself.
 */

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(apiScopes)).min(1).max(apiScopes.length),
  days: z.number().int().min(1).max(MAX_TOKEN_DAYS),
});

export type CreateTokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function createApiToken(input: unknown): Promise<CreateTokenResult> {
  const m = apiTokenMessages(await getLocale());
  if (!(await isEnabled("wos_workflows_v2"))) return { ok: false, error: m.errors.notFound };
  const session = await requireSession();
  // The page is staff's, as the menu says; the action must agree, since a
  // Server Action answers whoever calls it.
  if (!session.isStaff) return { ok: false, error: m.errors.staffOnly };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: interpolate(m.errors.invalid, { detail: parsed.error.issues[0]?.message ?? "" }) };
  }
  // Same bucket as other sensitive creations: a burst of tokens is a signal.
  const limited = await enforceRateLimit("invitation:create", session.userId);
  if (limited) return limited;

  const { token, hash, prefix } = generateToken();
  const db = await createSupabaseServerClient();
  const { error } = await db.from("api_token").insert({
    organization_id: session.organizationId,
    user_id: session.userId,
    name: parsed.data.name,
    token_hash: hash,
    token_prefix: prefix,
    scopes: [...new Set(parsed.data.scopes)],
    expires_at: new Date(Date.now() + parsed.data.days * 86_400_000).toISOString(),
  });
  if (error) return { ok: false, error: m.errors.createFailed };
  revalidatePath("/api-tokens");
  return { ok: true, token };
}

export async function revokeApiToken(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const m = apiTokenMessages(await getLocale());
  if (!(await isEnabled("wos_workflows_v2"))) return { ok: false, error: m.errors.notFound };
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: m.errors.staffOnly };
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.revokeFailed };
  const db = await createSupabaseServerClient();
  const { error } = await db.rpc("revoke_api_token", { p_token: parsed.data.id });
  if (error) return { ok: false, error: m.errors.revokeFailed };
  revalidatePath("/api-tokens");
  return { ok: true };
}
