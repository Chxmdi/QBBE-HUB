"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";

const createChannelSchema = (t: TranslateFn) => z.object({
  name: requiredText(t("channels.errors.nameRequired"), 80),
  purpose: z.string().trim().max(500).optional(),
  privacy: z.enum(["public", "private"]).default("public"),
  type: z
    .enum(["organization", "program", "project", "event", "operations", "leadership", "custom"])
    .default("custom"),
  projectId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
  postingPolicy: z.enum(["everyone", "staff", "admins"]).default("everyone"),
});

export async function createChannel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("channels.errors.staffRequired") };
  const parsed = createChannelSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("channels.errors.invalidInput") };
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
          ? t("channels.errors.duplicate")
          : t("channels.errors.createFailed"),
    };
  }

  await supabase.rpc("add_channel_member", {
    p_channel_id: channel.id,
    p_user_id: session.userId,
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
  await requireSession();
  const t = await getT();
  const parsed = z.string().uuid().safeParse(channelId);
  if (!parsed.success) return { ok: false, error: t("channels.errors.invalidChannel") };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("join_channel", {
    p_channel_id: parsed.data,
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: t("channels.errors.joinFailed") };
  }
  revalidatePath("/channels");
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

export async function leaveChannel(channelId: string): Promise<ActionResult> {
  await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channel")
    .select("is_mandatory")
    .eq("id", channelId)
    .maybeSingle();
  if (channel?.is_mandatory) {
    return { ok: false, error: t("channels.errors.mandatoryLeave") };
  }
  // RLS also blocks leaving mandatory channels (P0-ANN-01).
  const { error } = await supabase.rpc("leave_channel", {
    p_channel_id: channelId,
  });
  if (error) return { ok: false, error: t("channels.errors.leaveFailed") };
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
  const t = await getT();
  const parsed = muteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("channels.errors.invalidPreference") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("channel_member")
    .update({ muted_level: parsed.data.mutedLevel })
    .eq("channel_id", parsed.data.channelId)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: t("channels.errors.preferenceFailed") };

  revalidatePath("/settings");
  return { ok: true };
}

export async function addChannelMember(
  channelId: string,
  userId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channel")
    .select("owner_id")
    .eq("id", channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: t("channels.errors.notFound") };
  if (!session.isAdmin && channel.owner_id !== session.userId) {
    return { ok: false, error: t("channels.errors.ownerOrAdminAdd") };
  }
  const { error } = await supabase.rpc("add_channel_member", {
    p_channel_id: channelId,
    p_user_id: userId,
  });
  if (error && error.code !== "23505") {
    return { ok: false, error: t("channels.errors.addFailed") };
  }
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
  const t = await getT();
  const supabase = await createSupabaseServerClient();

  const { data: channel } = await supabase
    .from("channel")
    .select("is_mandatory, name")
    .eq("id", channelId)
    .maybeSingle();
  if (!channel) return { ok: false, error: t("channels.errors.notFound") };
  if (channel.is_mandatory && archived) {
    return {
      ok: false,
      error: t("channels.errors.mandatoryArchive"),
    };
  }

  const { error } = await supabase
    .from("channel")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", channelId);
  if (error) {
    return { ok: false, error: t("channels.errors.ownerOrAdmin") };
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
