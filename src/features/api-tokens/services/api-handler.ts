import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isEnabled } from "@/lib/feature-flags";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { bearerToken, hashToken, type ApiScope } from "../token";

/**
 * Every /api/v1 route goes through `apiRoute` (V2-8):
 *   1. the module is on (wos_workflows_v2), or the API answers 404;
 *   2. a valid token: known hash, not revoked, not expired, and its person is
 *      still an active member of its organization;
 *   3. the scope the route needs;
 *   4. a rate limit per token (120 calls a minute, like the app's writes);
 *   5. the call runs as the token's person (see `ApiIdentity`);
 *   6. every call, allowed or refused, is written to api_request_log.
 *
 * Errors are JSON: `{ "error": { "code": "...", "message": "..." } }`.
 */

export const API_RATE_LIMIT = { limit: 120, windowSeconds: 60 } as const;
export const API_ADDRESS_LIMIT = { limit: 600, windowSeconds: 60 } as const;

export interface ApiIdentity {
  tokenId: string;
  userId: string;
  organizationId: string;
  scopes: ApiScope[];
}

export interface ApiContext {
  db: SupabaseClient;
  identity: ApiIdentity;
  request: Request;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly headers: Record<string, string> = {}) {
    super(message);
  }
}

export function apiJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

interface TokenRow {
  id: string;
  user_id: string;
  organization_id: string;
  scopes: ApiScope[];
  expires_at: string;
  revoked_at: string | null;
}

export async function authenticate(db: SupabaseClient, header: string | null, now: Date): Promise<ApiIdentity> {
  const token = bearerToken(header);
  if (!token) throw new ApiError(401, "unauthenticated", "Send a token as `Authorization: Bearer qbbe_…`.");
  const { data } = await db
    .from("api_token")
    .select("id, user_id, organization_id, scopes, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  const row = data as TokenRow | null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= now.getTime()) {
    throw new ApiError(401, "invalid_token", "The token is unknown, revoked or expired.");
  }
  const { data: member } = await db
    .from("organization_membership")
    .select("user_id")
    .eq("organization_id", row.organization_id)
    .eq("user_id", row.user_id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) throw new ApiError(401, "invalid_token", "The token's owner is no longer an active member.");
  await db.from("api_token").update({ last_used_at: now.toISOString() }).eq("id", row.id);
  return { tokenId: row.id, userId: row.user_id, organizationId: row.organization_id, scopes: row.scopes };
}

type Handler<P> = (context: ApiContext, params: P) => Promise<Response>;

export function apiRoute<P = Record<string, never>>(scope: ApiScope | null, handler: Handler<P>) {
  return async (request: Request, route: { params: Promise<P> }): Promise<Response> => {
    const started = Date.now();
    const db = createSupabaseServiceClient();
    const url = new URL(request.url);
    let identity: ApiIdentity | null = null;
    let response: Response;
    let errorCode: string | null = null;
    try {
      if (!(await isEnabled("wos_workflows_v2", db))) throw new ApiError(404, "not_found", "Not found.");
      // Before any token lookup, so guessing tokens is slow and cheap for us.
      const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const perAddress = await checkRateLimit({ action: "api:v1:address", subject: address, ...API_ADDRESS_LIMIT });
      if (!perAddress.allowed) throw new ApiError(429, "rate_limited", "Too many calls. Try again later.", { "retry-after": "60" });
      identity = await authenticate(db, request.headers.get("authorization"), new Date());
      if (scope && !identity.scopes.includes(scope)) {
        throw new ApiError(403, "insufficient_scope", `This call needs the ${scope} scope.`);
      }
      const limited = await checkRateLimit({ action: "api:v1", subject: identity.tokenId, ...API_RATE_LIMIT });
      if (!limited.allowed) {
        const retry = limited.resetAt ? Math.max(1, Math.ceil((limited.resetAt.getTime() - Date.now()) / 1000)) : API_RATE_LIMIT.windowSeconds;
        throw new ApiError(429, "rate_limited", "Too many calls. Try again later.", { "retry-after": String(retry) });
      }
      response = await handler({ db, identity, request }, await route.params);
    } catch (error) {
      if (error instanceof ApiError) {
        errorCode = error.code;
        response = apiJson({ error: { code: error.code, message: error.message } }, error.status, error.headers);
      } else {
        errorCode = "internal";
        console.error(JSON.stringify({ event: "api.v1.failed", path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
        response = apiJson({ error: { code: "internal", message: "Something went wrong." } }, 500);
      }
    }
    const { error: logError } = await db.from("api_request_log").insert({
      organization_id: identity?.organizationId ?? null,
      token_id: identity?.tokenId ?? null,
      user_id: identity?.userId ?? null,
      method: request.method,
      path: url.pathname.slice(0, 300),
      status: response.status,
      error_code: errorCode,
      duration_ms: Date.now() - started,
    });
    if (logError) console.error(JSON.stringify({ event: "api.v1.audit_failed", error: logError.message }));
    return response;
  };
}

/** Whether the token's person may do `capability` on the object (app.can, as them, aal1). */
export async function canAs(db: SupabaseClient, identity: ApiIdentity, objectId: string, capability: string): Promise<boolean> {
  const { data, error } = await db.rpc("can_as", {
    p_user: identity.userId,
    p_object: objectId,
    p_capability: capability,
    p_assurance: "aal1",
  });
  return !error && data === true;
}
