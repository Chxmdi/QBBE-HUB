"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requiredText } from "@/lib/schema";
import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/features/tasks/services/task.commands";
import { createNotifications } from "@/features/jobs/services/notify";

const parentTypes = [
  "project",
  "task",
  "milestone",
  "event",
  "meeting",
  "agenda_item",
  "risk",
  "issue",
  "update",
  "organization",
  "contact",
  "opportunity",
] as const;

const commentSchema = z.object({
  parentType: z.enum(parentTypes),
  parentId: z.string().uuid(),
  body: requiredText("Write a comment.", 5000),
  parentCommentId: z.string().uuid().optional(),
  mentionIds: z.array(z.string().uuid()).max(20).optional(),
  // Checked against the organization's approved hosts by the database.
  linkUrl: z
    .string()
    .trim()
    .url("Enter a full https:// address.")
    .max(1000)
    .optional()
    .or(z.literal("")),
  documentId: z.string().uuid().optional().or(z.literal("")),
});

function commentError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  if (message.includes("not an approved source")) return message;
  if (message.includes("not available to attach")) return message;
  if (message.includes("Only the")) return message;
  if (message.includes("deleted comment")) return message;
  return fallback;
}

export async function addRecordComment(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid comment.",
    };
  }
  const data = parsed.data;
  const db = await createSupabaseServerClient();
  const { data: row, error } = await db
    .from("record_comment")
    .insert({
      organization_id: session.organizationId,
      parent_type: data.parentType,
      parent_id: data.parentId,
      parent_comment_id: data.parentCommentId ?? null,
      author_id: session.userId,
      body: data.body,
      link_url: data.linkUrl || null,
      document_id: data.documentId || null,
    })
    .select("id")
    .single();
  if (error || !row) {
    return {
      ok: false,
      error: commentError(error?.message, "Could not save the comment."),
    };
  }
  const commentId = row.id as string;
  // Recipients open the exact comment: /search resolves it to its record's
  // page, and the anchor lands on the comment itself.
  const link = `/search?comment=${commentId}`;

  const drafts: Parameters<typeof createNotifications>[1] = [];
  for (const userId of new Set(data.mentionIds ?? [])) {
    if (userId === session.userId) continue;
    drafts.push({
      user_id: userId,
      organization_id: session.organizationId,
      category: "mention",
      title: `${session.profile.full_name} mentioned you`,
      body: data.body.slice(0, 180),
      source_type: "comment",
      source_id: commentId,
      link,
      urgency: "normal",
      dedupe_key: `comment-mention:${commentId}:${userId}`,
    });
  }
  if (data.parentCommentId) {
    const { data: parent } = await db
      .from("record_comment")
      .select("author_id")
      .eq("id", data.parentCommentId)
      .maybeSingle();
    const parentAuthor = parent?.author_id as string | undefined;
    if (
      parentAuthor &&
      parentAuthor !== session.userId &&
      !drafts.some((draft) => draft.user_id === parentAuthor)
    ) {
      drafts.push({
        user_id: parentAuthor,
        organization_id: session.organizationId,
        category: "mention",
        title: `${session.profile.full_name} replied to your comment`,
        body: data.body.slice(0, 180),
        source_type: "comment",
        source_id: commentId,
        link,
        urgency: "normal",
        dedupe_key: `comment-reply:${commentId}:${parentAuthor}`,
      });
    }
  }
  if (drafts.length > 0) {
    // The comment is saved either way; a notification failure is not the
    // author's to retry.
    try {
      await createNotifications(db, drafts);
    } catch (notifyError) {
      console.error("comment notification failed", notifyError);
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, id: commentId };
}

const editSchema = z.object({
  commentId: z.string().uuid(),
  body: requiredText("Write a comment.", 5000),
});

/** The author rewrites their comment; the database marks it edited. */
export async function editRecordComment(input: unknown): Promise<ActionResult> {
  await requireSession();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid comment.",
    };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_comment")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .select("id");
  if (error)
    return {
      ok: false,
      error: commentError(error.message, "Could not edit the comment."),
    };
  if (!data || data.length === 0)
    return { ok: false, error: "Comment not found." };
  revalidatePath("/", "layout");
  return { ok: true, id: parsed.data.commentId };
}

/**
 * Deletion keeps the row and its thread: the database stamps who deleted it and
 * when, writes an audit event, and the thread shows a marker in its place.
 */
export async function deleteRecordComment(
  commentId: string,
): Promise<ActionResult> {
  await requireSession();
  if (!z.string().uuid().safeParse(commentId).success) {
    return { ok: false, error: "Comment not found." };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_comment")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .select("id");
  if (error)
    return {
      ok: false,
      error: commentError(error.message, "Could not delete the comment."),
    };
  if (!data || data.length === 0)
    return { ok: false, error: "Comment not found." };
  revalidatePath("/", "layout");
  return { ok: true, id: commentId };
}

export async function resolveRecordComment(
  commentId: string,
): Promise<ActionResult> {
  await requireSession();
  if (!z.string().uuid().safeParse(commentId).success) {
    return { ok: false, error: "Comment not found." };
  }
  const db = await createSupabaseServerClient();
  // resolved_by is stamped by the database from the signed-in user.
  const { data, error } = await db
    .from("record_comment")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", commentId)
    .select("id");
  if (error)
    return {
      ok: false,
      error: commentError(error.message, "Could not resolve the comment."),
    };
  if (!data || data.length === 0)
    return { ok: false, error: "Comment not found." };
  revalidatePath("/", "layout");
  return { ok: true, id: commentId };
}
