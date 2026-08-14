"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";

const sendMessageSchema = z.object({
  channelId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  threadRootId: z.string().uuid().optional(),
  body: z.string().trim().min(1, "Message cannot be empty.").max(10000),
});

/**
 * Persists the message in Postgres before it is treated as sent (MSG-001).
 * Mentions are parsed and persisted server-side (MSG-005): "@Full Name"
 * tokens are matched against active members, and each match receives one
 * deduplicated notification.
 */
export async function sendMessage(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { channelId, conversationId, threadRootId, body } = parsed.data;
  if (!channelId && !conversationId) {
    return { ok: false, error: "Message needs a destination." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: message, error } = await supabase
    .from("message")
    .insert({
      organization_id: session.organizationId,
      channel_id: channelId ?? null,
      conversation_id: conversationId ?? null,
      thread_root_id: threadRootId ?? null,
      author_id: session.userId,
      body,
    })
    .select("id")
    .single();

  if (error || !message) {
    return {
      ok: false,
      error:
        "Your message was not sent. You may not have posting permission in this channel.",
    };
  }

  // Server-side mention parsing (MSG-005).
  if (body.includes("@")) {
    const { data: members } = await supabase
      .from("organization_membership")
      .select("user_id, user_profile:user_id(full_name)")
      .eq("status", "active");

    type MemberRow = {
      user_id: string;
      user_profile: { full_name: string } | null;
    };
    const lowered = body.toLowerCase();
    const mentioned = ((members ?? []) as unknown as MemberRow[]).filter(
      (m) =>
        m.user_profile &&
        m.user_id !== session.userId &&
        lowered.includes(`@${m.user_profile.full_name.toLowerCase()}`),
    );

    for (const member of mentioned) {
      await supabase.from("message_mention").insert({
        message_id: message.id,
        mentioned_user_id: member.user_id,
      });
      await supabase.from("notification").insert({
        user_id: member.user_id,
        organization_id: session.organizationId,
        category: "mention",
        title: `${session.profile.full_name} mentioned you`,
        body: body.slice(0, 140),
        source_type: "message",
        source_id: message.id,
        link: channelId ? `/channels/${channelId}` : `/messages/${conversationId}`,
        dedupe_key: `mention:${message.id}:${member.user_id}`,
      });
    }
  }

  // Thread replies notify the thread author (deduplicated, P0-NOT-04).
  if (threadRootId) {
    const { data: root } = await supabase
      .from("message")
      .select("author_id")
      .eq("id", threadRootId)
      .maybeSingle();
    if (root && root.author_id !== session.userId) {
      await supabase.from("notification").insert({
        user_id: root.author_id,
        organization_id: session.organizationId,
        category: "reply",
        title: `${session.profile.full_name} replied to your message`,
        body: body.slice(0, 140),
        source_type: "message",
        source_id: message.id,
        link: channelId ? `/channels/${channelId}?thread=${threadRootId}` : `/messages/${conversationId}`,
        dedupe_key: `reply:${message.id}:${root.author_id}`,
      });
    }
  }

  return { ok: true, id: message.id as string };
}

export async function toggleReaction(
  messageId: string,
  emoji: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!/^\p{Extended_Pictographic}/u.test(emoji) || emoji.length > 8) {
    return { ok: false, error: "Invalid reaction." };
  }
  const supabase = await createSupabaseServerClient();

  const { data: existing } = await supabase
    .from("message_reaction")
    .select("message_id")
    .eq("message_id", messageId)
    .eq("user_id", session.userId)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("message_reaction")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", session.userId)
      .eq("emoji", emoji);
  } else {
    // Unique PK (message, user, emoji) prevents duplicate toggles (MSG-006).
    await supabase.from("message_reaction").insert({
      message_id: messageId,
      user_id: session.userId,
      emoji,
    });
  }
  return { ok: true };
}

const editSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().trim().min(1, "Message cannot be empty.").max(10000),
});

/**
 * Edits a message within policy (P0-MSG-05). Authorship is enforced by RLS;
 * edited_at preserves visible evidence that the message changed.
 */
export async function editMessage(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { messageId, body } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("message")
    .select("author_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Message not found." };
  if (existing.author_id !== session.userId) {
    return { ok: false, error: "You can only edit your own messages." };
  }
  if (existing.deleted_at) {
    return { ok: false, error: "This message was deleted." };
  }

  const { error } = await supabase
    .from("message")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) return { ok: false, error: "Could not save the edit." };

  return { ok: true };
}

/**
 * Message → agenda item (P0-LINK-03). Keeps the source message link and
 * proposes the converting user as owner.
 */
export async function convertMessageToAgendaItem(
  messageId: string,
  meetingId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // RLS filters this read — inaccessible messages cannot be converted.
  const { data: message } = await supabase
    .from("message")
    .select("id, body")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: "Message not found or not accessible." };

  const { count } = await supabase
    .from("agenda_item")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meetingId);

  const title = (message.body as string).split("\n")[0].slice(0, 300);
  const { error } = await supabase.from("agenda_item").insert({
    meeting_id: meetingId,
    title,
    kind: "discussion",
    owner_id: session.userId,
    proposed_by: session.userId,
    source_message_id: messageId,
    sort_key: (count ?? 0) + 1,
    status: session.isStaff ? "accepted" : "proposed",
  });
  if (error) return { ok: false, error: "Could not add the agenda item." };

  revalidatePath(`/meetings/${meetingId}`);
  return { ok: true, id: meetingId };
}

/**
 * Message → decision (P0-LINK-04), linked back to the originating thread.
 */
export async function convertMessageToDecision(
  messageId: string,
  detail?: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!session.isStaff) return { ok: false, error: "Staff access required." };
  const supabase = await createSupabaseServerClient();

  const { data: message } = await supabase
    .from("message")
    .select("id, body, channel:channel_id(project_id)")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: "Message not found or not accessible." };

  type ChannelRef = { project_id: string | null } | null;
  const channel = message.channel as unknown as ChannelRef;
  const title = (message.body as string).split("\n")[0].slice(0, 300);

  const { data: decision, error } = await supabase
    .from("decision")
    .insert({
      organization_id: session.organizationId,
      project_id: channel?.project_id ?? null,
      title,
      detail: detail || `Captured from a channel conversation.`,
      decided_by: session.userId,
      source_message_id: messageId,
    })
    .select("id")
    .single();
  if (error || !decision) return { ok: false, error: "Could not record the decision." };

  revalidatePath("/", "layout");
  return { ok: true, id: decision.id as string };
}

/** Pins a message as a durable channel resource (P0-RES-02). */
export async function pinMessage(
  messageId: string,
  channelId: string,
  title: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Give the pinned resource a title." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("pinned_resource").insert({
    channel_id: channelId,
    message_id: messageId,
    title: trimmed,
    pinned_by: session.userId,
  });
  if (error) {
    return { ok: false, error: "Could not pin — channel managers and staff can pin." };
  }

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: "message_pinned",
    object_type: "message",
    object_id: messageId,
  });

  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

export async function unpinResource(
  resourceId: string,
  channelId: string,
): Promise<ActionResult> {
  await requireSession();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("pinned_resource")
    .delete()
    .eq("id", resourceId);
  if (error) return { ok: false, error: "Could not remove the pin." };
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

export async function deleteMessage(messageId: string): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  // Soft delete preserves audit evidence (MSG-004).
  const { error } = await supabase
    .from("message")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) return { ok: false, error: "Could not delete the message." };

  await supabase.from("audit_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    event_type: "communication",
    action: "message_deleted",
    object_type: "message",
    object_id: messageId,
  });
  return { ok: true };
}

/**
 * Message → task conversion (P0-LINK-02): preserves a secure source link
 * and quoted context without duplicating inaccessible content.
 */
export async function convertMessageToTask(
  messageId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();

  // RLS filters this read — an inaccessible message cannot be converted.
  const { data: message } = await supabase
    .from("message")
    .select("id, body, channel_id, channel:channel_id(project_id, program_id)")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) return { ok: false, error: "Message not found or not accessible." };

  type ChannelRef = { project_id: string | null; program_id: string | null } | null;
  const channel = message.channel as unknown as ChannelRef;
  const title = (message.body as string).split("\n")[0].slice(0, 200);

  const { data: task, error } = await supabase
    .from("task")
    .insert({
      organization_id: session.organizationId,
      project_id: channel?.project_id ?? null,
      program_id: channel?.program_id ?? null,
      title,
      description: `Created from a channel message:\n\n> ${message.body}`,
      assignee_id: session.userId,
      requester_id: session.userId,
      source_message_id: messageId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !task) return { ok: false, error: "Could not create the task." };

  await supabase.from("activity_event").insert({
    organization_id: session.organizationId,
    actor_id: session.userId,
    verb: "created",
    source_type: "task",
    source_id: task.id,
    project_id: channel?.project_id ?? null,
    program_id: channel?.program_id ?? null,
    summary: `converted a message into task “${title}”`,
  });

  revalidatePath("/my-work");
  return { ok: true, id: task.id as string };
}

const startConversationSchema = z.object({
  memberIds: z.array(z.string().uuid()).min(1).max(8),
});

export async function startConversation(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick at least one person." };
  const memberIds = Array.from(
    new Set([...parsed.data.memberIds, session.userId]),
  );

  const supabase = await createSupabaseServerClient();
  const { data: conversation, error } = await supabase
    .from("conversation")
    .insert({
      organization_id: session.organizationId,
      is_group: memberIds.length > 2,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !conversation) {
    return { ok: false, error: "Could not start the conversation." };
  }

  const { error: memberError } = await supabase.from("conversation_member").insert(
    memberIds.map((userId) => ({
      conversation_id: conversation.id,
      user_id: userId,
    })),
  );
  if (memberError) {
    return { ok: false, error: "Could not add participants." };
  }

  revalidatePath("/messages");
  return { ok: true, id: conversation.id as string };
}

/** Advances the conversation read cursor. */
export async function markConversationRead(
  conversationId: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("conversation_member")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", session.userId);
  return { ok: true };
}
