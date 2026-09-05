import { DEFAULT_TIME_ZONE } from "@/lib/time";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrgRole, Profile } from "@/types/entities";

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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: membership } = await supabase
      .from("organization_membership")
      .select("organization_id, role, status, user_profile:user_id(*), organization:organization_id(timezone)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) return null;

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
  redirect("/account-inactive");
}

/** Route gate for staff-and-above surfaces (portfolio, CRM, reports). */
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
