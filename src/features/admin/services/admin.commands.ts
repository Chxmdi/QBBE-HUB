"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";

const inviteSchema = z.object({
  email: z.string().trim().email("Enter a valid email."),
  intendedRole: z.enum(["admin", "leadership_viewer", "staff", "volunteer", "guest"]).default("staff"),
});

/**
 * Creates an invitation record (AUTH-007). When the invitee signs up with
 * this email, the bootstrap trigger applies the intended role and marks the
 * invitation accepted.
 */
export interface InviteResult extends ActionResult {
  emailSent?: boolean;
}

export async function inviteUser(input: unknown): Promise<InviteResult> {
  const session = await requireSession();

  const limited = await enforceRateLimit("invitation:create", session.userId);
  if (limited) return limited;
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { email, intendedRole } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: invitation, error } = await supabase
    .from("invitation")
    .insert({
      organization_id: session.organizationId,
      email: email.toLowerCase(),
      intended_role: intendedRole,
      invited_by: session.userId,
    })
    .select("id")
    .single();
  if (error || !invitation) return { ok: false, error: "Could not create the invitation." };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "access",
    action: "user_invited",
    object_type: "invitation",
    object_id: invitation.id,
    metadata: { email, intended_role: intendedRole },
  });

  revalidatePath("/admin");
  return {
    ok: true,
    emailSent: false,
  };
}

const roleSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(["admin", "leadership_viewer", "staff", "volunteer", "guest"]),
});

export async function changeMemberRole(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input." };
  const { membershipId, role } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: membership } = await supabase
    .from("organization_membership")
    .select("role, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: "Membership not found." };
  if (membership.role === "owner") {
    return { ok: false, error: "The Primary Owner role can only change via ownership transfer." };
  }

  const { data: updated, error } = await supabase
    .from("organization_membership")
    .update({ role })
    .eq("id", membershipId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { ok: false, error: "Could not change the role." };

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}

export async function setMemberActive(
  membershipId: string,
  active: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };

  const supabase = await createSupabaseServerClient();
  const { data: membership } = await supabase
    .from("organization_membership")
    .select("role, user_id")
    .eq("id", membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: "Membership not found." };
  if (membership.role === "owner") {
    return { ok: false, error: "The Primary Owner cannot be deactivated." };
  }
  if (membership.user_id === session.userId) {
    return { ok: false, error: "You cannot deactivate your own account." };
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
  if (error || !updated) return { ok: false, error: "Could not update the account." };

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
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Admin access required." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("invitation")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("accepted_at", null);
  if (error) return { ok: false, error: "Could not revoke the invitation." };
  revalidatePath("/admin");
  return { ok: true };
}

export async function transferOwnership(targetMembershipId: string): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== "owner") {
    return { ok: false, error: "Only the Primary Owner can transfer ownership." };
  }
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from("organization_membership")
    .select("id, user_id, role, status")
    .eq("id", targetMembershipId)
    .maybeSingle();
  if (!target) return { ok: false, error: "Membership not found." };
  if (target.status !== "active") {
    return { ok: false, error: "Cannot transfer ownership to a deactivated account." };
  }
  if (target.user_id === session.userId) {
    return { ok: false, error: "You already hold Primary Owner." };
  }

  const { error } = await supabase.rpc("transfer_organization_ownership", {
    p_target_membership: targetMembershipId,
  });
  if (error) return { ok: false, error: "Could not transfer ownership." };

  revalidatePath("/admin");
  revalidatePath("/people");
  return { ok: true };
}
