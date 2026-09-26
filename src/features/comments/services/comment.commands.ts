"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";

const parentTypes = [
  "project", "task", "milestone", "event", "meeting", "agenda_item",
  "risk", "issue", "update", "organization", "contact", "opportunity",
] as const;

const commentSchema = z.object({
  parentType: z.enum(parentTypes),
  parentId: z.string().uuid(),
  body: requiredText("Write a comment.", 5000),
  parentCommentId: z.string().uuid().optional(),
  mentionIds: z.array(z.string().uuid()).max(20).optional(),
});

export async function addRecordComment(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_comment")
    .insert({
      organization_id: session.organizationId,
      parent_type: parsed.data.parentType,
      parent_id: parsed.data.parentId,
      parent_comment_id: parsed.data.parentCommentId ?? null,
      author_id: session.userId,
      body: parsed.data.body,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save the comment." };

  const mentions = (parsed.data.mentionIds ?? []).filter((userId) => userId !== session.userId);
  const drafts = mentions.map((userId) => ({
    user_id: userId,
    organization_id: session.organizationId,
    category: "mention",
    title: `${session.profile.full_name} mentioned you`,
    body: parsed.data.body.slice(0, 180),
    source_type: parsed.data.parentType,
    source_id: parsed.data.parentId,
    link: `/search?comment=${data.id}`,
    urgency: "normal" as const,
    reason: "mentioned",
    context: parsed.data.body.slice(0, 180),
    project_id: parsed.data.parentType === "project" ? parsed.data.parentId : null,
    dedupe_key: notificationDedupeKey(parsed.data.parentType, parsed.data.parentId, userId),
  }));

  if (parsed.data.parentCommentId) {
    const { data: parent } = await db
      .from("record_comment")
      .select("author_id")
      .eq("id", parsed.data.parentCommentId)
      .maybeSingle();
    const authorId = parent?.author_id as string | undefined;
    if (authorId && authorId !== session.userId) {
      const existing = drafts.find((draft) => draft.user_id === authorId);
      if (existing) {
        existing.reason = existing.reason ? `${existing.reason}, reply` : "reply";
      } else {
        drafts.push({
          user_id: authorId,
          organization_id: session.organizationId,
          category: "reply",
          title: `${session.profile.full_name} replied to your comment`,
          body: parsed.data.body.slice(0, 180),
          source_type: parsed.data.parentType,
          source_id: parsed.data.parentId,
          link: `/search?comment=${data.id}`,
          urgency: "normal" as const,
          reason: "reply",
          context: parsed.data.body.slice(0, 180),
          project_id: parsed.data.parentType === "project" ? parsed.data.parentId : null,
          dedupe_key: notificationDedupeKey(parsed.data.parentType, parsed.data.parentId, authorId),
        });
      }
    }
  }

  if (drafts.length) await createNotifications(db, drafts);

  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function resolveRecordComment(commentId: string): Promise<ActionResult> {
  const session = await requireSession();
  const db = await createSupabaseServerClient();
  const { error } = await db
    .from("record_comment")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: session.userId,
    })
    .eq("id", commentId);
  if (error) return { ok: false, error: "Could not resolve the comment." };
  revalidatePath("/", "layout");
  return { ok: true };
}
