import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requiresAdministratorMfa, verifiedTotpFactors } from "@/features/auth/mfa";
import type { OrgRole, Profile } from "@/types/entities";
import {
  VERIFIED_USER_HEADER,
  decodeVerifiedUser,
} from "@/lib/verified-user-header";

export const ADMIN_ACCESS_REQUIRED_ERROR = "Admin access required.";
export const OWNER_ACCESS_REQUIRED_ERROR = "Only the Primary Owner can perform this action.";
export const ADMIN_MFA_REQUIRED_ERROR =
  "Complete multi-factor authentication before performing this action.";
export const ADMIN_MFA_UNAVAILABLE_ERROR =
  "Could not verify multi-factor authentication. Try again.";

/**
 * The caller is authenticated, but the request reached the database without an
 * identity, so nothing about their membership could be determined. Distinct
 * from "no active membership", which is an answer; this is the absence of one.
 */
export class SessionNotEstablishedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNotEstablishedError";
  }
}

export interface SessionContext {
  userId: string;
  email: string;
  profile: Profile;
  role: OrgRole;
  organizationId: string;
  /**
   * The organization's zone, used to read and render scheduled times.
   * Carried on the session because a `datetime-local` value means nothing
   * without it, and every scheduling path needs the same answer.
   */
  timeZone: string;
  isAdmin: boolean;
  isStaff: boolean;
}

/**
 * Resolves the signed-in user with their profile and organization role.
 * Cached per request. Route-level convenience only — RLS remains the
 * authorization boundary (AUTH-003).
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createSupabaseServerClient();
    // The request proxy has already verified this session with Auth and
    // passed the result on; asking again cost every page a second round trip
    // (#115). Without it (a path the proxy does not see), verify here.
    const verified = decodeVerifiedUser(
      (await headers()).get(VERIFIED_USER_HEADER),
    );
    const user =
      verified ?? (await supabase.auth.getUser()).data.user ?? null;
    if (!user) return null;

    const { data: membership, error: membershipError } = await supabase
      .from("organization_membership")
      .select("organization_id, role, status, user_profile:user_id(*), organization:organization_id(timezone)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    // A failed read is not a deactivated membership. Returning null here would
    // send an active member to /account-inactive and tell them an
    // administrator removed their access, which is a lie the person cannot
    // act on and support cannot reproduce. Fail loudly instead.
    if (membershipError) {
      throw new Error(`Could not read membership for ${user.id}: ${membershipError.message}`);
    }

    if (!membership) {
      // Empty, with no error, has two causes and they need opposite handling.
      // `membership_read` is `app.is_org_member(...)`, which begins
      // `auth.uid() is not null`, so a request that reached PostgREST without
      // a usable token reads nothing at all — the membership may be perfectly
      // active and simply unreadable by nobody. Ask the database who it
      // thinks is calling before concluding anything about the membership.
      const { data: actorId } = await supabase.rpc("current_actor_id");
      if (!actorId) {
        throw new SessionNotEstablishedError(
          "The session did not reach the database; membership could not be read.",
        );
      }
      return null;
    }

    const profile = membership.user_profile as unknown as Profile;
    const role = membership.role as OrgRole;

    return {
      userId: user.id,
      email: user.email ?? "",
      profile,
      role,
      organizationId: membership.organization_id as string,
      timeZone:
        (membership.organization as unknown as { timezone: string | null } | null)
          ?.timezone ?? DEFAULT_TIME_ZONE,
      isAdmin: role === "owner" || role === "admin",
      isStaff: role === "owner" || role === "admin" || role === "staff",
    };
  },
);

/** Redirects to sign-in when unauthenticated; inactive members get a dedicated page. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (session) return session;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  // Reaching here means getSessionContext resolved to null with a usable
  // database identity, which is the one case that really is an inactive
  // membership. The other two now throw before they can get this far.
  redirect("/account-inactive");
}

/**
 * Route gate for organization-wide staff surfaces (CRM administration).
 * Record pages should use `requireSession` and let RLS plus capability
 * helpers decide visibility so assigned volunteers are not bounced home.
 */
export async function requireStaff(): Promise<SessionContext> {
  const session = await requireSession();
  if (!session.isStaff) redirect("/");
  return session;
}

/** Route gate for admin-only surfaces. */
export async function requireAdmin(): Promise<SessionContext> {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/");
  return session;
}

export type PrivilegedActionAuthorization =
  | { ok: true; session: SessionContext }
  | { ok: false; error: string; reason: "role" | "mfa" | "unavailable" };

/**
 * Authorizes an owner/admin mutation at the Server Action boundary.
 *
 * Server Actions are public-facing endpoints, so the workspace layout is only
 * navigation help and must not be the authorization boundary. RLS and RPC
 * checks remain authoritative underneath this early, actionable failure.
 */
export async function authorizeAdminAction(options?: {
  ownerOnly?: boolean;
}): Promise<PrivilegedActionAuthorization> {
  const session = await requireSession();
  if (!session.isAdmin || (options?.ownerOnly && session.role !== "owner")) {
    return {
      ok: false,
      error: options?.ownerOnly ? OWNER_ACCESS_REQUIRED_ERROR : ADMIN_ACCESS_REQUIRED_ERROR,
      reason: "role",
    };
  }

  const supabase = await createSupabaseServerClient();
  const [assuranceResult, factorResult] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (
    assuranceResult.error ||
    !assuranceResult.data ||
    factorResult.error ||
    !factorResult.data
  ) {
    return { ok: false, error: ADMIN_MFA_UNAVAILABLE_ERROR, reason: "unavailable" };
  }
  if (
    requiresAdministratorMfa(
      session.isAdmin,
      assuranceResult.data.currentLevel,
      assuranceResult.data.nextLevel,
      verifiedTotpFactors(factorResult.data.all).length > 0,
    )
  ) {
    return { ok: false, error: ADMIN_MFA_REQUIRED_ERROR, reason: "mfa" };
  }

  return { ok: true, session };
}

/** Route-level equivalent of `authorizeAdminAction`, including stale-AAL handling. */
export async function requireAdminAal2(): Promise<SessionContext> {
  const authorization = await authorizeAdminAction();
  if (authorization.ok) return authorization.session;
  if (authorization.reason === "role") redirect("/");
  redirect("/mfa");
}
