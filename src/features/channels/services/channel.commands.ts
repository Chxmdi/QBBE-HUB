"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createChannelSchema = z.object({
  name: requiredText("A channel needs a name.", 80),
  purpose: z.string().trim().max(500).optional(),
  privacy: z.enum(["public", "private"]).default("public"),
  type: z
    .enum(["organization", "team", "program", "project", "event", "operations", "leadership", "custom"])
    .default("custom"),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  postingPolicy: z.enum(["everyone", "staff", "admins"]).default("everyone"),
});

export async function createChannel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createChannelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, purpose, privacy, type, projectId, programId, postingPolicy } =
    parsed.data;
  const supabase = await createSupabaseServerClient();

  const slug = slugify(name) || `channel-${Date.now().toString(36)}`;
  const { data: channel, error } = await supabase
    .from("channel")
    .insert({
      organization_id: session.organizationId,
      name,
      slug,
      type,
      privacy,
      purpose: purpose || null,
      project_id: projectId ?? null,
      program_id: programId ?? null,
      posting_policy: postingPolicy,
      owner_id: session.userId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !channel) {
    return {
      ok: false,
      error:
        error?.code === "23505"
          ? "A channel with that name already exists."
          : "Could not create the channel.",
    };
  }

  await supabase.from("channel_member").insert({
    channel_id: channel.id,
    user_id: session.userId,
    role: "manager",
    membership_source: "manual",
  });

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: "channel_created",
    object_type: "channel",
    object_id: channel.id,
    metadata: { privacy, type },
  });

  revalidatePath("/channels");
  return { ok: true, id: channel.id as string };
}

export async function joinChannel(channelId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("channel_member").insert({
    channel_id: channelId,
    user_id: session.userId,
    membership_source: "manual",
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not join this channel." };
  }
  revalidatePath("/channels");
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

export async function leaveChannel(channelId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channel")
    .select("is_mandatory")
    .eq("id", channelId)
    .maybeSingle();
  if (channel?.is_mandatory) {
    return { ok: false, error: "You cannot leave a mandatory channel." };
  }
  // RLS also blocks leaving mandatory channels (P0-ANN-01).
  const { error } = await supabase
    .from("channel_member")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: "You cannot leave this channel." };
  revalidatePath("/channels");
  return { ok: true };
}

const muteSchema = z.object({
  channelId: z.string().uuid(),
  mutedLevel: z.enum(["all", "mentions", "muted"]),
});

/** Updates only the caller's delivery preference for a channel. */
export async function setChannelMute(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = muteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid channel preference." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("channel_member")
    .update({ muted_level: parsed.data.mutedLevel })
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: "Could not update this channel preference." };

  revalidatePath("/settings");
  return { ok: true };
}

export async function addChannelMember(
  channelId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channel")
    .select("owner_id")
    .eq("id", channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Channel not found." };
  if (!session.isAdmin && channel.owner_id !== session.userId) {
    return { ok: false, error: "Only the channel owner or an admin can add members." };
  }
  const { error } = await supabase.from("channel_member").insert({
    channel_id: channelId,
    user_id: userId,
    membership_source: "manual",
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: "Could not add that member." };
  }
  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: "channel_member_added",
    object_type: "channel",
    object_id: channelId,
    metadata: { user_id: userId },
  });
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

/**
 * Archive / restore a channel (P0-COMM-05). History is preserved and stays
 * searchable for authorized members; archived channels are read-only
 * because can_post_in_channel requires archived_at is null. Both directions
 * are audited (P0-GOV-05).
 */
export async function setChannelArchived(
  channelId: string,
  archived: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: channel } = await supabase
    .from("channel")
    .select("is_mandatory, name")
    .eq("id", channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: "Channel not found." };
  if (channel.is_mandatory && archived) {
    return {
      ok: false,
      error: "The mandatory announcements channel cannot be archived.",
    };
  }

  const { error } = await supabase
    .from("channel")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", channelId);
  if (error) {
    return { ok: false, error: "Only the channel owner or an admin can do that." };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: archived ? "channel_archived" : "channel_restored",
    object_type: "channel",
    object_id: channelId,
    metadata: { name: channel.name },
  });

  revalidatePath("/channels");
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

/** Advances the member's last-read cursor (MSG-007). */
export async function markChannelRead(channelId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("channel_member")
    .update({ last_read_at: new Date().toISOString() })
    .eq("channel_id", channelId)
    .eq("user_id", session.userId);
  return { ok: true };
}
