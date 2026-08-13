"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const createChannelSchema = z.object({
  name: z.string().trim().min(1, "A channel needs a name.").max(80),
  purpose: z.string().trim().max(500).optional(),
  privacy: z.enum(["public", "private"]).default("public"),
  type: z
    .enum(["organization", "team", "program", "project", "event", "operations", "leadership", "custom"])
    .default("custom"),
  projectId: z.string().uuid().optional(),
});

export async function createChannel(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const parsed = createChannelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { name, purpose, privacy, type, projectId } = parsed.data;
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
  // RLS blocks leaving mandatory channels (P0-ANN-01).
  const { error } = await supabase
    .from("channel_member")
    .delete()
    .eq("channel_id", channelId)
    .eq("user_id", session.userId);
  if (error) return { ok: false, error: "You cannot leave this channel." };
  revalidatePath("/channels");
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
