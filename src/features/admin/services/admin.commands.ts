"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import { reportError } from "@/lib/observability";
import { sendEmail } from "@/features/notifications/services/email-provider";
import { renderInvitationEmail } from "@/features/notifications/services/email-templates";
import {
  INVITATION_LIFETIME_DAYS,
  createInvitationSecret,
  hashInvitationToken,
  invitationLink,
} from "./invitation-link";

const inviteSchema = (t: TranslateFn) => z.object({
  email: z.string().trim().email(t("admin.errors.validEmail")),
  intendedRole: z.enum(["admin", "leadership_viewer", "staff", "volunteer", "guest"]).default("staff"),
});

/**
 * An invitation is claimed with a secret link (SEC-001): the person must open
 * it to create their account, and the membership is granted only once their
 * address is confirmed (`app.handle_new_user`). The secret is emailed and also
 * returned to the administrator, once, so an invitation still works where
 * email is not set up. The invitation keeps only its hash.
 */
export interface InviteResult extends ActionResult {
  emailSent?: boolean;
  inviteLink?: string;
  expiresAt?: string;
  /** The zone the email states the expiry in, so the dialog names the same day. */
  timeZone?: string;
}

interface InvitationDelivery {
  emailSent: boolean;
  inviteLink: string;
}

/**
 * Email the invitation link. A failure to send never fails the invitation:
 * the administrator still gets the link to pass on, and the reason is logged.
 * The "log" transport reports success without sending anything, so it counts
 * as not sent.
 */
async function deliverInvitation(input: {
  token: string;
  email: string;
  role: string;
  expiresAt: string;
  organizationId: string;
  inviterName: string;
  timeZone: string;
  invitationId: string;
}): Promise<InvitationDelivery> {
  const inviteLink = invitationLink(input.token);
  const supabase = await createSupabaseServerClient();
  const { data: organization } = await supabase
    .from("organization")
    .select("name")
    .eq("id", input.organizationId)
    .maybeSingle();
  const message = renderInvitationEmail({
    link: inviteLink,
    email: input.email,
    organizationName: organization?.name ?? "QBBE Hub",
    inviterName: input.inviterName,
    role: input.role,
    expiresAt: input.expiresAt,
    timeZone: input.timeZone,
  });
  try {
    const sent = await sendEmail({
      idempotencyKey: `invitation:${input.invitationId}:${hashInvitationToken(input.token).slice(0, 16)}`,
      to: input.email,
      ...message,
    });
    return { emailSent: sent.provider !== "log", inviteLink };
  } catch (error) {
    reportError(error, { action: "invitation_email", invitation: input.invitationId });
    return { emailSent: false, inviteLink };
  }
}

function invitationExpiry(): string {
  return new Date(Date.now() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function inviteUser(input: unknown): Promise<InviteResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;

  const limited = await enforceRateLimit("invitation:create", session.userId);
  if (limited) return limited;
  const parsed = inviteSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("admin.errors.invalidInput") };
  }
  const email = parsed.data.email.toLowerCase();
  const { intendedRole } = parsed.data;
  const { token, tokenHash } = createInvitationSecret();
  const expiresAt = invitationExpiry();

  const supabase = await createSupabaseServerClient();
  const { data: invitation, error } = await supabase
    .from("invitation")
    .insert({
      organization_id: session.organizationId,
      email,
      intended_role: intendedRole,
      invited_by: session.userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !invitation) return { ok: false, error: t("admin.errors.inviteFailed") };

  const delivery = await deliverInvitation({
    token,
    email,
    role: intendedRole,
    expiresAt,
    organizationId: session.organizationId,
    inviterName: session.profile.full_name || session.email,
    timeZone: session.timeZone,
    invitationId: invitation.id,
  });

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "access",
    action: "user_invited",
    object_type: "invitation",
    object_id: invitation.id,
    metadata: { email, intended_role: intendedRole, email_sent: delivery.emailSent },
  });

  revalidatePath("/admin");
  return {
    ok: true,
    emailSent: delivery.emailSent,
    inviteLink: delivery.inviteLink,
    expiresAt,
    timeZone: session.timeZone,
  };
}

/**
 * A fresh link for a pending (or expired) invitation: the old link stops
 * working, the new one is emailed and shown, and the clock restarts. This is
 * also how invitations made before links existed get one.
 */
export async function reissueInvitation(invitationId: string): Promise<InviteResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;

  const limited = await enforceRateLimit("invitation:create", session.userId);
  if (limited) return limited;
  if (!z.string().uuid().safeParse(invitationId).success) {
    return { ok: false, error: t("admin.errors.invalidInput") };
  }

  const { token, tokenHash } = createInvitationSecret();
  const expiresAt = invitationExpiry();
  const supabase = await createSupabaseServerClient();
  const { data: invitation, error } = await supabase
    .from("invitation")
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, email, intended_role, organization_id")
    .maybeSingle();
  if (error || !invitation) {
    return { ok: false, error: t("admin.workspace.invitations.newLinkFailed") };
  }

  const delivery = await deliverInvitation({
    token,
    email: invitation.email,
    role: invitation.intended_role,
    expiresAt,
    organizationId: invitation.organization_id,
    inviterName: session.profile.full_name || session.email,
    timeZone: session.timeZone,
    invitationId: invitation.id,
  });

  await supabase.from("audit_event").insert({
    organization_id: invitation.organization_id,
    actor_id: session.userId,
    event_type: "access",
    action: "invitation_link_reissued",
    object_type: "invitation",
    object_id: invitation.id,
    metadata: { email: invitation.email, email_sent: delivery.emailSent },
  });

  revalidatePath("/admin");
  return {
    ok: true,
    emailSent: delivery.emailSent,
    inviteLink: delivery.inviteLink,
    expiresAt,
    timeZone: session.timeZone,
  };
}

const roleSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(["admin", "leadership_viewer", "staff", "volunteer", "guest"]),
});

export async function changeMemberRole(input: unknown): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("admin.errors.invalidInput") };
  const { membershipId, role } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: membership } = await supabase
    .from("organization_membership")
    .select("role, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: t("admin.errors.membershipNotFound") };
  if (membership.role === "owner") {
    return { ok: false, error: t("admin.errors.ownerRoleLocked") };
  }

  const { data: updated, error } = await supabase
    .from("organization_membership")
    .update({ role })
    .eq("id", membershipId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: t("admin.errors.roleChangeFailed") };

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}

export async function setMemberActive(
  membershipId: string,
  active: boolean,
): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;

  const supabase = await createSupabaseServerClient();
  const { data: membership } = await supabase
    .from("organization_membership")
    .select("role, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: t("admin.errors.membershipNotFound") };
  if (membership.role === "owner") {
    return { ok: false, error: t("admin.errors.ownerCannotDeactivate") };
  }
  if (membership.user_id === session.userId) {
    return { ok: false, error: t("admin.errors.cannotDeactivateSelf") };
  }

  const { data: updated, error } = await supabase
    .from("organization_membership")
    .update({
      status: active ? "active" : "deactivated",
      deactivated_at: active ? null : new Date().toISOString(),
    })
    .eq("id", membershipId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: t("admin.errors.accountUpdateFailed") };

  if (!active) {
    try {
      const { createSupabaseServiceClient } = await import("@/lib/supabase/service");
      const admin = createSupabaseServiceClient();
      await admin.auth.admin.signOut(membership.user_id, "global");
    } catch {
      // Service role is optional; the account-inactive page still blocks the UI.
    }
  }

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction();
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const supabase = await createSupabaseServerClient();
  const { data: revoked, error } = await supabase
    .from("invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();
  if (error || !revoked) return { ok: false, error: t("admin.errors.revokeFailed") };
  revalidatePath("/admin");
  return { ok: true };
}

export async function transferOwnership(targetMembershipId: string): Promise<ActionResult> {
  const t = await getT();
  const authorization = await authorizeAdminAction({ ownerOnly: true });
  if (!authorization.ok) return { ok: false, error: authorization.error };
  const session = authorization.session;
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from("organization_membership")
    .select("id, user_id, role, status")
    .eq("id", targetMembershipId)
    .maybeSingle();
  if (!target) return { ok: false, error: t("admin.errors.membershipNotFound") };
  if (target.status !== "active") {
    return { ok: false, error: t("admin.errors.transferToDeactivated") };
  }
  if (target.user_id === session.userId) {
    return { ok: false, error: t("admin.errors.alreadyOwner") };
  }

  const { error } = await supabase.rpc("transfer_organization_ownership", {
    p_target_membership: targetMembershipId,
  });
  if (error) return { ok: false, error: t("admin.errors.transferFailed") };

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}
