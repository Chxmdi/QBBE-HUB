"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mentionRecipientIds } from "@/features/channels/mention-recipients";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { channelMuteAllows } from "@/features/notifications/services/mute";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/server";
import type { TranslateFn } from "@/lib/i18n/translate";
import { recipientTranslators } from "@/features/channels/recipient-locale";

const sendMessageSchema = (t: TranslateFn) => z.object({
  channelId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  threadRootId: z.string().uuid().optional(),
  body: requiredText(t("messages.errors.empty"), 10000),
});

/**
 * Persists the message in Postgres before it is treated as sent (MSG-001).
 * Mentions are parsed and persisted server-side (MSG-005): "@Full Name"
 * tokens are matched against active members, and each match receives one
 * deduplicated notification.
 */
export async function sendMessage(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();

  const limited = await enforceRateLimit("message:create", session.userId);
  if (limited) return limited;
  const parsed = sendMessageSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("messages.errors.invalidInput") };
  }
  const { channelId, conversationId, threadRootId, body } = parsed.data;
  if (!channelId && !conversationId) {
    return { ok: false, error: t("messages.errors.noDestination") };
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
      error: t("messages.errors.notSent"),
    };
  }

  // Server-side mention parsing (MSG-005).
  if (body.includes("@")) {
    const [{ data: members }, { data: teams }, { data: audience }] = await Promise.all([
      supabase.from("organization_membership").select("user_id, user_profile:user_id(full_name)").eq("status", "active"),
      supabase.from("team").select("id, name").eq("organization_id", session.organizationId),
      channelId
        ? supabase.from("channel_member").select("user_id").eq("channel_id", channelId)
        : supabase.from("conversation_member").select("user_id").eq("conversation_id", conversationId!),
    ]);

    type MemberRow = {
      user_id: string;
      user_profile: { full_name: string } | null;
    };
    const teamIds = (teams ?? []).map((team) => team.id as string);
    const { data: teamMembers } = teamIds.length
      ? await supabase.from("team_member").select("team_id, user_id").in("team_id", teamIds)
      : { data: [] as { team_id: string; user_id: string }[] };
    const mentioned = mentionRecipientIds({
      body,
      authorId: session.userId,
      eligibleUserIds: (audience ?? []).map((row) => row.user_id as string),
      members: ((members ?? []) as unknown as MemberRow[]).flatMap((member) => member.user_profile
        ? [{ userId: member.user_id, fullName: member.user_profile.full_name }]
        : []),
      teams: (teams ?? []).map((team) => ({ id: team.id as string, name: team.name as string })),
      teamMembers: (teamMembers ?? []).map((member) => ({ teamId: member.team_id as string, userId: member.user_id as string })),
    });

    const muteByUser = new Map<string, string>();
    if (channelId && mentioned.length > 0) {
      const { data: muteRows } = await supabase
        .from("channel_member")
        .select("user_id, muted_level")
        .eq("channel_id", channelId)
        .in("user_id", mentioned);
      for (const row of muteRows ?? []) {
        muteByUser.set(row.user_id as string, row.muted_level as string);
      }
    }

    const recipientT = await recipientTranslators(supabase, mentioned);
    const mentionDrafts = mentioned
      .filter((userId) => channelMuteAllows(muteByUser.get(userId) ?? "all", "mention"))
      .map((userId) => ({
        user_id: userId,
        organization_id: session.organizationId,
        category: "mention",
        title: recipientT(userId)("messages.notifications.mentioned", {
          name: session.profile.full_name,
        }),
        body: body.slice(0, 140),
        source_type: "message",
        source_id: message.id as string,
        link: channelId
          ? `/channels/${channelId}${threadRootId ? `?thread=${threadRootId}` : `?message=${message.id}`}`
          : `/messages/${conversationId}`,
        reason: "mentioned",
        context: body.slice(0, 140),
        thread_id: threadRootId ?? (message.id as string),
        dedupe_key: notificationDedupeKey("message", message.id as string, userId),
      }));

    for (const userId of mentioned) {
      await supabase.from("message_mention").insert({
        message_id: message.id,
        mentioned_user_id: userId,
      });
    }
    if (mentionDrafts.length > 0) await createNotifications(supabase, mentionDrafts);
  }

  // Thread replies notify the thread author (deduplicated, P0-NOT-04).
  if (threadRootId) {
    const { data: root } = await supabase
      .from("message")
      .select("author_id")
      .eq("id", threadRootId)
      .maybeSingle();
    if (root && root.author_id !== session.userId) {
      let level = "all";
      if (channelId) {
        const { data: member } = await supabase
          .from("channel_member")
          .select("muted_level")
          .eq("channel_id", channelId)
          .eq("user_id", root.author_id)
          .maybeSingle();
        level = (member?.muted_level as string | undefined) ?? "all";
      }
      if (channelMuteAllows(level, "reply")) {
        const recipientT = await recipientTranslators(supabase, [root.author_id as string]);
        await createNotifications(supabase, [{
          user_id: root.author_id as string,
          organization_id: session.organizationId,
          category: "reply",
          title: recipientT(root.author_id as string)("messages.notifications.replied", {
            name: session.profile.full_name,
          }),
          body: body.slice(0, 140),
          source_type: "message",
          source_id: message.id as string,
          link: channelId ? `/channels/${channelId}?thread=${threadRootId}` : `/messages/${conversationId}`,
          reason: "reply",
          context: body.slice(0, 140),
          thread_id: threadRootId,
          dedupe_key: notificationDedupeKey("message", message.id as string, root.author_id as string),
        }]);
      }
    }
  }

  return { ok: true, id: message.id as string };
}

export async function toggleReaction(
  messageId: string,
  emoji: string,
): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  if (!/^\p{Extended_Pictographic}/u.test(emoji) || emoji.length > 8) {
    return { ok: false, error: t("messages.errors.invalidReaction") };
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

/**
 * Saves a message to the caller's personal collection. The readable-message
 * lookup deliberately happens before the write: a guessed UUID must never be
 * enough to create a reference to a private channel or conversation.
 */
export async function toggleSavedMessage(
  messageId: string,
): Promise<ActionResult & { saved?: boolean }> {
  const session = await requireSession();
  const t = await getT();
  if (!z.string().uuid().safeParse(messageId).success) {
    return { ok: false, error: t("messages.errors.invalidMessage") };
  }

  const supabase = await createSupabaseServerClient();
  const { data: message } = await supabase
    .from("message")
    .select("id")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: t("messages.errors.notAccessible") };

  const { data: existing } = await supabase
    .from("saved_message")
    .select("message_id")
    .eq("user_id", session.userId)
    .eq("message_id", messageId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("saved_message")
      .delete()
      .eq("user_id", session.userId)
      .eq("message_id", messageId);
    if (error) return { ok: false, error: t("messages.errors.unsaveFailed") };
    revalidatePath("/saved");
    return { ok: true, saved: false };
  }

  const { error } = await supabase.from("saved_message").insert({
    user_id: session.userId,
    message_id: messageId,
  });
  if (error) return { ok: false, error: t("messages.errors.saveFailed") };
  revalidatePath("/saved");
  return { ok: true, saved: true };
}

const editSchema = (t: TranslateFn) => z.object({
  messageId: z.string().uuid(),
  body: requiredText(t("messages.errors.empty"), 10000),
});

/**
 * Edits a message within policy (P0-MSG-05). Authorship is enforced by RLS;
 * edited_at preserves visible evidence that the message changed.
 */
export async function editMessage(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const parsed = editSchema(t).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t("messages.errors.invalidInput") };
  }
  const { messageId, body } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase
    .from("message")
    .select("author_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();

  if (!existing) return { ok: false, error: t("messages.errors.notFound") };
  if (existing.author_id !== session.userId) {
    return { ok: false, error: t("messages.errors.ownOnly") };
  }
  if (existing.deleted_at) {
    return { ok: false, error: t("messages.errors.deleted") };
  }

  const { error } = await supabase
    .from("message")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) return { ok: false, error: t("messages.errors.editFailed") };

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
  const t = await getT();
  const supabase = await createSupabaseServerClient();

  // RLS filters this read — inaccessible messages cannot be converted.
  const { data: message } = await supabase
    .from("message")
    .select("id, body")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: t("messages.errors.notAccessible") };

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
  if (error) return { ok: false, error: t("messages.errors.agendaFailed") };

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
  const t = await getT();
  if (!session.isStaff) return { ok: false, error: t("messages.errors.staffRequired") };
  const supabase = await createSupabaseServerClient();

  const { data: message } = await supabase
    .from("message")
    .select("id, body, channel:channel_id(project_id)")
    .eq("id", messageId)
    .maybeSingle();
  if (!message) return { ok: false, error: t("messages.errors.notAccessible") };

  type ChannelRef = { project_id: string | null } | null;
  const channel = message.channel as unknown as ChannelRef;
  const title = (message.body as string).split("\n")[0].slice(0, 300);

  const { data: decision, error } = await supabase
    .from("decision")
    .insert({
      organization_id: session.organizationId,
      project_id: channel?.project_id ?? null,
      title,
      detail: detail || t("messages.decisionDetail"),
      decided_by: session.userId,
      source_message_id: messageId,
    })
    .select("id")
    .single();
  if (error || !decision) return { ok: false, error: t("messages.errors.decisionFailed") };

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
  const t = await getT();
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: t("messages.errors.pinTitleRequired") };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("pinned_resource").insert({
    channel_id: channelId,
    message_id: messageId,
    title: trimmed,
    pinned_by: session.userId,
  });
  if (error) {
    return { ok: false, error: t("messages.errors.pinFailed") };
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
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("pinned_resource")
    .delete()
    .eq("id", resourceId);
  if (error) return { ok: false, error: t("messages.errors.unpinFailed") };
  revalidatePath(`/channels/${channelId}`);
  return { ok: true };
}

export async function deleteMessage(messageId: string): Promise<ActionResult> {
  const session = await requireSession();
  const t = await getT();
  const supabase = await createSupabaseServerClient();
  // Soft delete preserves audit evidence (MSG-004).
  const { error } = await supabase
    .from("message")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (error) return { ok: false, error: t("messages.errors.deleteFailed") };

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
  const t = await getT();
  const supabase = await createSupabaseServerClient();

  // RLS filters this read — an inaccessible message cannot be converted.
  const { data: message } = await supabase
    .from("message")
    .select("id, body, channel_id, channel:channel_id(project_id, program_id)")
    .eq("id", messageId)
    .maybeSingle();

  if (!message) return { ok: false, error: t("messages.errors.notAccessible") };

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
      description: t("messages.taskDescription", { body: message.body as string }),
      assignee_id: session.userId,
      requester_id: session.userId,
      source_message_id: messageId,
      created_by: session.userId,
    })
    .select("id")
    .single();

  if (error || !task) return { ok: false, error: t("messages.errors.taskFailed") };

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
  const t = await getT();
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("messages.errors.pickPeople") };
  const memberIds = Array.from(
    new Set([...parsed.data.memberIds, session.userId]),
  );

  const supabase = await createSupabaseServerClient();
  // The id is chosen here, not read back: conversation's read policy is
  // membership, and the members are only added below, so
  // insert(...).select() failed row-level security and no conversation could
  // be started (#112).
  const conversation = { id: randomUUID() };
  const { error } = await supabase.from("conversation").insert({
    id: conversation.id,
    organization_id: session.organizationId,
    is_group: memberIds.length > 2,
    created_by: session.userId,
  });

  if (error) {
    return { ok: false, error: t("messages.errors.startFailed") };
  }

  const { error: memberError } = await supabase.from("conversation_member").insert(
    memberIds.map((userId) => ({
      conversation_id: conversation.id,
      user_id: userId,
    })),
  );
  if (memberError) {
    return { ok: false, error: t("messages.errors.participantsFailed") };
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
