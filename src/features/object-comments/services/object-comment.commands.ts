"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requiredText } from "@/lib/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/i18n/server";
import { isLocale, DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { createNotifications, notificationDedupeKey } from "@/features/jobs/services/notify";
import { fill } from "@/features/collab/i18n";
import { blockIdSchema, objectTypeKeySchema } from "../schema";
import { extractMentions, MAX_MENTIONS, plainText } from "../mentions";
import { reactionKeys } from "../reactions";
import { commentTargetFor, objectCommentsPath } from "../target";
import { objectCommentsText, type ObjectCommentsText } from "../messages";
import { findMentionCandidates, type MentionCandidate } from "./object-comment.queries";

export interface CommentActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const MAX_BODY = 5000;

const bodySchema = (m: ObjectCommentsText) =>
  requiredText(m.errors.bodyRequired)
    .max(MAX_BODY, m.errors.tooLong)
    .refine((body) => {
      const { people, objects } = extractMentions(body);
      return people.length <= MAX_MENTIONS && objects.length <= MAX_MENTIONS;
    }, m.errors.tooManyMentions);

const addSchema = (m: ObjectCommentsText) =>
  z.object({
    object: z.object({ id: z.string().uuid(), type: objectTypeKeySchema }),
    blockId: blockIdSchema.nullable().optional(),
    /** A stretch of the block's text the comment is about (V1-17). */
    anchor: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        quote: z.string().min(1).max(500),
      })
      .refine((anchor) => anchor.end > anchor.start)
      .nullable()
      .optional(),
    parentCommentId: z.string().uuid().nullable().optional(),
    body: bodySchema(m),
  });

/** Puts the database's English refusals into the reader's language. */
function translateError(message: string | undefined, fallback: string, m: ObjectCommentsText) {
  if (!message) return fallback;
  if (message.includes("row-level security")) return m.errors.forbidden;
  if (message.includes("Only the author can edit")) return m.errors.authorOnly;
  if (message.includes("Only the author or an administrator")) return m.errors.authorOrAdmin;
  if (message.includes("deleted comment")) return m.errors.deletedComment;
  if (message.includes("at most 20")) return m.errors.tooManyMentions;
  return fallback;
}

async function text(): Promise<ObjectCommentsText> {
  return objectCommentsText(await getLocale());
}

/**
 * Records the comment's mentions and tells the people the database says may
 * be told: active members who can read the thread's record and were not
 * already mentioned in this comment.
 */
async function syncMentions(
  db: Db,
  input: {
    commentId: string;
    body: string;
    organizationId: string;
    authorName: string;
    parentType: string;
    parentId: string;
    link: string;
  },
): Promise<void> {
  const { people, objects } = extractMentions(input.body);
  const { data, error } = await db.rpc("set_comment_mentions", {
    p_comment: input.commentId,
    p_people: people,
    p_objects: objects,
  });
  if (error) throw new Error(error.message);
  const recipients = ((data ?? []) as unknown[]).map(String);
  if (recipients.length === 0) return;

  const { data: profiles } = await db
    .from("user_profile")
    .select("id, locale")
    .in("id", recipients);
  const localeOf = new Map<string, Locale>();
  for (const row of (profiles ?? []) as { id: string; locale: string | null }[]) {
    if (isLocale(row.locale)) localeOf.set(row.id, row.locale);
  }
  const snippet = plainText(input.body).slice(0, 180);
  try {
    await createNotifications(
      db,
      recipients.map((userId) => ({
        user_id: userId,
        organization_id: input.organizationId,
        category: "mention",
        title: fill(
          objectCommentsText(localeOf.get(userId) ?? DEFAULT_LOCALE).notifications.mentioned,
          { name: input.authorName },
        ),
        body: snippet,
        context: snippet,
        source_type: input.parentType,
        source_id: input.parentId,
        link: input.link,
        urgency: "normal" as const,
        reason: "mentioned",
        project_id: input.parentType === "project" ? input.parentId : null,
        dedupe_key: notificationDedupeKey(input.parentType, input.parentId, userId),
      })),
    );
  } catch (notifyError) {
    // The comment and its mentions are saved; a failed notice is not the
    // author's to retry.
    console.error("object comment notification failed", notifyError);
  }
}

export async function addObjectComment(input: unknown): Promise<CommentActionResult> {
  const session = await requireSession();
  const limited = await enforceRateLimit("comment:create", session.userId);
  if (limited) return limited;
  const m = await text();
  const parsed = addSchema(m).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? m.errors.invalid };
  }
  const data = parsed.data;
  const target = commentTargetFor(data.object, data.blockId ?? null);
  const db = await createSupabaseServerClient();
  const { data: row, error } = await db
    .from("record_comment")
    .insert({
      organization_id: session.organizationId,
      parent_type: target.parentType,
      parent_id: target.parentId,
      block_id: target.blockId,
      anchor: target.blockId && data.anchor ? data.anchor : null,
      parent_comment_id: data.parentCommentId ?? null,
      author_id: session.userId,
      body: data.body,
    })
    .select("id")
    .single();
  if (error || !row) {
    return { ok: false, error: translateError(error?.message, m.errors.saveFailed, m) };
  }
  const commentId = row.id as string;
  try {
    await syncMentions(db, {
      commentId,
      body: data.body,
      organizationId: session.organizationId,
      authorName: session.profile.full_name,
      parentType: target.parentType,
      parentId: target.parentId,
      link: objectCommentsPath(data.object, commentId, target.blockId),
    });
  } catch (mentionError) {
    console.error("object comment mentions failed", mentionError);
  }
  revalidatePath("/collab", "layout");
  return { ok: true, id: commentId };
}

const editSchema = (m: ObjectCommentsText) =>
  z.object({
    commentId: z.string().uuid(),
    object: z.object({ id: z.string().uuid(), type: objectTypeKeySchema }),
    body: bodySchema(m),
  });

/** The author rewrites their comment; newly mentioned people are told. */
export async function editObjectComment(input: unknown): Promise<CommentActionResult> {
  const session = await requireSession();
  const m = await text();
  const parsed = editSchema(m).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? m.errors.invalid };
  }
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_comment")
    .update({ body: parsed.data.body })
    .eq("id", parsed.data.commentId)
    .select("id, parent_type, parent_id, block_id");
  if (error) return { ok: false, error: translateError(error.message, m.errors.saveFailed, m) };
  const row = data?.[0] as { id: string; parent_type: string; parent_id: string; block_id: string | null } | undefined;
  if (!row) return { ok: false, error: m.errors.notFound };
  try {
    await syncMentions(db, {
      commentId: row.id,
      body: parsed.data.body,
      organizationId: session.organizationId,
      authorName: session.profile.full_name,
      parentType: row.parent_type,
      parentId: row.parent_id,
      link: objectCommentsPath(parsed.data.object, row.id, row.block_id),
    });
  } catch (mentionError) {
    console.error("object comment mentions failed", mentionError);
  }
  revalidatePath("/collab", "layout");
  return { ok: true, id: row.id };
}

async function updateComment(
  commentId: unknown,
  patch: Record<string, string | null>,
): Promise<CommentActionResult> {
  await requireSession();
  const m = await text();
  const id = z.string().uuid().safeParse(commentId);
  if (!id.success) return { ok: false, error: m.errors.notFound };
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("record_comment")
    .update(patch)
    .eq("id", id.data)
    .select("id");
  if (error) return { ok: false, error: translateError(error.message, m.errors.saveFailed, m) };
  if (!data || data.length === 0) return { ok: false, error: m.errors.notFound };
  revalidatePath("/collab", "layout");
  return { ok: true, id: id.data };
}

/** Resolving or reopening a thread; the database stamps who did it. */
export async function setObjectCommentResolved(
  commentId: string,
  resolved: boolean,
): Promise<CommentActionResult> {
  return updateComment(commentId, {
    resolved_at: resolved ? new Date().toISOString() : null,
  });
}

/** Deletion leaves a marker in the thread and an audit event. */
export async function deleteObjectComment(commentId: string): Promise<CommentActionResult> {
  return updateComment(commentId, { deleted_at: new Date().toISOString() });
}

const reactionSchema = z.object({
  commentId: z.string().uuid(),
  reaction: z.enum(reactionKeys),
  on: z.boolean(),
});

/** Adds or takes back one reaction by the signed-in person. */
export async function setObjectCommentReaction(input: unknown): Promise<CommentActionResult> {
  const session = await requireSession();
  const m = await text();
  const parsed = reactionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: m.errors.reactionFailed };
  const { commentId, reaction, on } = parsed.data;
  const db = await createSupabaseServerClient();
  const { error } = on
    ? await db
        .from("record_comment_reaction")
        .upsert(
          { comment_id: commentId, user_id: session.userId, reaction },
          { onConflict: "comment_id,user_id,reaction", ignoreDuplicates: true },
        )
    : await db
        .from("record_comment_reaction")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", session.userId)
        .eq("reaction", reaction);
  if (error) return { ok: false, error: translateError(error.message, m.errors.reactionFailed, m) };
  revalidatePath("/collab", "layout");
  return { ok: true, id: commentId };
}


/** People and objects for the `@` picker, as the signed-in person sees them. */
export async function searchMentionTargets(query: unknown): Promise<MentionCandidate[]> {
  await requireSession();
  const parsed = z.string().max(40).safeParse(query);
  if (!parsed.success) return [];
  return findMentionCandidates(parsed.data);
}
