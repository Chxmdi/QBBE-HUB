"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

export async function acknowledgeAnnouncement(
  announcementId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("announcement_acknowledgment")
    .upsert(
      {
        announcement_id: announcementId,
        user_id: session.userId,
        method: "click",
      },
      { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
    );

  if (error) return { ok: false, error: "Could not record acknowledgment." };

  revalidatePath("/", "layout");
  return { ok: true };
}

const publishSchema = z.object({
  title: z.string().trim().min(1, "Announcements need a title.").max(200),
  body: z.string().trim().min(1, "Announcements need content.").max(10000),
  priority: z.enum(["normal", "important", "critical"]).default("normal"),
  requiresAck: z.boolean().default(false),
  ackDeadline: z.string().optional(),
  publishAt: z.string().optional(),
});

/**
 * Publishes to the mandatory announcements channel. Posting permission is
 * enforced by RLS (announcement insert requires admin; the channel's
 * posting_policy governs the message insert) — ANN-002.
 */
export async function publishAnnouncement(
  input: unknown,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = publishSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { title, body, priority, requiresAck, ackDeadline, publishAt } = parsed.data;
  const publishAtIso = publishAt ? new Date(publishAt).toISOString() : new Date().toISOString();
  const isScheduled = new Date(publishAtIso).getTime() > Date.now() + 30_000;

  const supabase = await createSupabaseServerClient();
  const { data: channel } = await supabase
    .from("channel")
    .select("id")
    .eq("type", "announcements")
    .eq("is_mandatory", true)
    .maybeSingle();

  if (!channel) return { ok: false, error: "No announcements channel exists." };

  const { data: message, error: messageError } = await supabase
    .from("message")
    .insert({
      organization_id: session.organizationId,
      channel_id: channel.id,
      author_id: session.userId,
      body,
    })
    .select("id")
    .single();

  if (messageError || !message) {
    return {
      ok: false,
      error: "You don't have permission to post announcements, or the save failed.",
    };
  }

  const { data: announcement, error: annError } = await supabase
    .from("announcement")
    .insert({
      message_id: message.id,
      organization_id: session.organizationId,
      title,
      priority,
      requires_ack: requiresAck,
      ack_deadline: requiresAck && ackDeadline ? ackDeadline : null,
      publish_at: publishAtIso,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (annError || !announcement) {
    return { ok: false, error: "Could not publish the announcement." };
  }

  // Fan out now; scheduled announcements wait for the publish job (P1-ANN-07).
  const { data: members } = await supabase
    .from("organization_membership")
    .select("user_id")
    .eq("status", "active");

  const recipients = isScheduled
    ? []
    : (members ?? [])
        .map((m) => m.user_id as string)
        .filter((id) => id !== session.userId);

  if (recipients.length > 0) {
    await supabase.from("notification").insert(
      recipients.map((userId) => ({
        user_id: userId,
        organization_id: session.organizationId,
        category: "announcement",
        title: `Announcement: ${title}`,
        body: body.slice(0, 140),
        source_type: "announcement",
        source_id: announcement.id,
        link: "/channels",
        urgency: priority === "critical" ? "critical" : "normal",
        dedupe_key: `announcement:${announcement.id}:${userId}`,
      })),
    );
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: "announcement_published",
    object_type: "announcement",
    object_id: announcement.id,
    metadata: { priority, requires_ack: requiresAck },
  });

  revalidatePath("/", "layout");
  return { ok: true, id: announcement.id as string };
}
