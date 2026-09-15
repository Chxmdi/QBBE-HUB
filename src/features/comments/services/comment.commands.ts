"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { createNotifications } from "@/features/jobs/services/notify";

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

  const mentions = parsed.data.mentionIds ?? [];
  if (mentions.length) {
    await createNotifications(
      db,
      mentions
        .filter((userId) => userId !== session.userId)
        .map((userId) => ({
          user_id: userId,
          organization_id: session.organizationId,
          category: "mention",
          title: `${session.profile.full_name} mentioned you`,
          body: parsed.data.body.slice(0, 180),
          source_type: "comment",
          source_id: data.id as string,
          link: `/search?comment=${data.id}`,
          urgency: "normal" as const,
          dedupe_key: `comment-mention:${data.id}:${userId}`,
        })),
    );
  }

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
